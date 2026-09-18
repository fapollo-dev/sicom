import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelBalancoDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { BalanceteService } from './balancete.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface Linha {
  codplanocontas: number; codiexpandido: string; descricao: string; classe: string | null; nivel: number;
  sintetica: boolean; saldoAnterior: number; debito: number; credito: number; saldoAtual: number; movimentada: boolean;
}

/**
 * BALANÇO PATRIMONIAL (`FRMRELBALANCO`). **8 acessos, 3 operadores.** Dossiê: `uRelBalanco.md`. Migration 265.
 *
 * O irmão patrimonial do balancete (mig 258): só **ativo e passivo** (código expandido começando em 1 ou 2)
 * e numa DATA — saldo anterior (tudo antes do 1º dia do mês da data), débito e crédito do mês até a data,
 * saldo atual. O legado tem os checkboxes Degrau / Analíticas / Sem movimento.
 *
 * ── ⚠️ O modo "só sintéticas" do legado devolve zero linhas, sempre ───────────────────────────────────
 * Desmarcar "Analíticas" acrescenta `AND PP.CLASSE = 'S'`, e `PLANO_CONTAS.CLASSE` no cliente só tem 'A'
 * (10.950) e 'T' (78) — **nenhum 'S'**. Aqui, como no balancete, sintética é a conta que TEM FILHA (ou
 * `CLASSE` em S/T), e o roll-up soma por prefixo do código expandido, com o ponto separando os níveis.
 */
@Injectable()
export class RelBalancoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** o 1º dia do mês da data do balanço — a fronteira do "saldo anterior" no legado. */
  static inicioDoMes(data: string): string {
    return `${data.slice(0, 8)}01`;
  }

  async gerar(f: RelBalancoDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const ini = RelBalancoService.inicioDoMes(f.data);

    const mov = (await sql<Record<string, unknown>>`
      WITH d AS (
        SELECT d.contadebito AS conta, d.valor, d.datalan FROM diario d WHERE d.codempresa = ${emp} AND d.datalan <= ${f.data}::date
      ), c AS (
        SELECT d.contacredito AS conta, d.valor, d.datalan FROM diario d WHERE d.codempresa = ${emp} AND d.datalan <= ${f.data}::date
      )
      SELECT conta,
             sum(CASE WHEN datalan < ${ini}::date THEN sinal * valor ELSE 0 END) AS saldo_anterior,
             sum(CASE WHEN datalan >= ${ini}::date AND sinal = 1 THEN valor ELSE 0 END) AS debito,
             sum(CASE WHEN datalan >= ${ini}::date AND sinal = -1 THEN valor ELSE 0 END) AS credito
        FROM (SELECT conta, valor, datalan, 1 AS sinal FROM d UNION ALL SELECT conta, valor, datalan, -1 FROM c) x
       WHERE conta IS NOT NULL
       GROUP BY conta`.execute(db)).rows;
    const porConta = new Map<number, { sa: number; de: number; cr: number }>();
    for (const m of mov) porConta.set(Number(m.conta), { sa: num(m.saldo_anterior), de: num(m.debito), cr: num(m.credito) });

    // só ativo e passivo: `PP.CODIEXPANDIDO < '3'` no legado
    const plano = (await sql<Record<string, unknown>>`
      SELECT codplanocontas, coalesce(codiexpandido, '') AS codiexpandido, descricao, classe, nivel
        FROM plano_contas
       WHERE coalesce(codiexpandido, '') <> '' AND codiexpandido < '3'
       ORDER BY codiexpandido`.execute(db)).rows.map((p) => ({
      codplanocontas: Number(p.codplanocontas), codiexpandido: String(p.codiexpandido), descricao: String(p.descricao ?? ''),
      classe: (p.classe as string | null) ?? null,
      nivel: p.nivel == null ? BalanceteService.nivelDe(String(p.codiexpandido)) : Number(p.nivel),
    }));

    const linhas: Linha[] = plano.map((p) => {
      const prefixo = `${p.codiexpandido}.`;
      let sa = 0, de = 0, cr = 0;
      for (const q of plano) {
        if (q.codiexpandido === p.codiexpandido || q.codiexpandido.startsWith(prefixo)) {
          const m = porConta.get(q.codplanocontas);
          if (m) { sa += m.sa; de += m.de; cr += m.cr; }
        }
      }
      const sintetica = p.classe === 'S' || p.classe === 'T' || plano.some((q) => q.codiexpandido.startsWith(prefixo));
      return { ...p, sintetica, saldoAnterior: r2(sa), debito: r2(de), credito: r2(cr), saldoAtual: r2(sa + de - cr), movimentada: sa !== 0 || de !== 0 || cr !== 0 };
    });

    const saida = linhas.filter((l) =>
      l.nivel <= f.nivelMax
      && (f.semMovimento || l.movimentada)
      && (f.analiticas || l.sintetica));

    // ativo = código começando em 1; passivo = em 2 (a raiz de cada grupo)
    const raiz = (c: string) => saida.find((l) => l.codiexpandido === c || l.codiexpandido.startsWith(`${c}.`)) && linhas.find((l) => l.codiexpandido === c);
    const totalDe = (c: string) => {
      const r = linhas.find((l) => l.codiexpandido === c);
      return r ? { codigo: c, descricao: r.descricao, saldoAnterior: r.saldoAnterior, debito: r.debito, credito: r.credito, saldoAtual: r.saldoAtual } : null;
    };
    const ativo = totalDe('1');
    const passivo = totalDe('2');

    return {
      data: f.data,
      competencia: { de: ini, ate: f.data },
      linhas: saida.map((l) => ({ ...l, degrau: f.degrau ? '  '.repeat(Math.max(0, l.nivel - 1)) : '' })),
      ativo, passivo,
      /** ativo − |passivo|: no legado a conferência é visual; aqui vem pronta. */
      diferenca: ativo && passivo ? r2(ativo.saldoAtual + passivo.saldoAtual) : null,
      totais: {
        contas: saida.length, contasNoPlano: plano.length, movimentadas: linhas.filter((l) => l.movimentada).length,
        sinteticas: linhas.filter((l) => l.sintetica).length,
        /** o modo do legado: quantas contas teriam `CLASSE='S'` — zero, no cliente. */
        classeS: plano.filter((p) => p.classe === 'S').length,
      },
    };
  }
}
