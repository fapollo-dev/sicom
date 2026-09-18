import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { BalanceteDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface Linha { codplanocontas: number; codiexpandido: string; descricao: string; classe: string | null; nivel: number; sintetica: boolean; saldoAnterior: number; debito: number; credito: number; saldoAtual: number; movimentada: boolean }

/**
 * BALANCETE DE VERIFICAÇÃO (`FRMRELBALANCETE`). **14 acessos, 4 operadores.** Dossiê: `uRelBalancete.md`. Migration 258.
 *
 * Por conta: saldo anterior (débitos − créditos antes do período), débitos e créditos do período, saldo atual.
 * O nível sai do CÓDIGO EXPANDIDO (1 · 1.1 · 1.1.01 · 1.1.01.01 · 15 posições) e o roll-up das sintéticas é por
 * prefixo — o legado só somava nos pais as contas com `NIVEL` preenchido, e **520 das 658 contas com lançamento**
 * no cliente não têm nível.
 */
@Injectable()
export class BalanceteService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  static nivelDe(cod: string): number {
    const n = cod.length;
    return n <= 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : n <= 9 ? 4 : 5;
  }

  async gerar(f: BalanceteDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;

    // o movimento por conta analítica: antes do período (saldo anterior) e no período (débito/crédito)
    const mov = (await sql<Record<string, unknown>>`
      WITH d AS (
        SELECT d.contadebito AS conta, d.valor, d.datalan FROM diario d WHERE d.codempresa = ${emp} AND d.datalan < ${f.dataFim}::date + 1
      ), c AS (
        SELECT d.contacredito AS conta, d.valor, d.datalan FROM diario d WHERE d.codempresa = ${emp} AND d.datalan < ${f.dataFim}::date + 1
      )
      SELECT conta,
             sum(CASE WHEN datalan < ${f.dataIni}::date THEN sinal * valor ELSE 0 END) AS saldo_anterior,
             sum(CASE WHEN datalan >= ${f.dataIni}::date AND sinal = 1 THEN valor ELSE 0 END) AS debito,
             sum(CASE WHEN datalan >= ${f.dataIni}::date AND sinal = -1 THEN valor ELSE 0 END) AS credito
        FROM (SELECT conta, valor, datalan, 1 AS sinal FROM d UNION ALL SELECT conta, valor, datalan, -1 FROM c) x
       WHERE conta IS NOT NULL
       GROUP BY conta
    `.execute(db)).rows;
    const porConta = new Map<number, { sa: number; de: number; cr: number }>();
    for (const m of mov) porConta.set(Number(m.conta), { sa: num(m.saldo_anterior), de: num(m.debito), cr: num(m.credito) });

    const plano = (await sql<Record<string, unknown>>`
      SELECT codplanocontas, coalesce(codiexpandido, '') AS codiexpandido, descricao, classe, nivel
        FROM plano_contas WHERE coalesce(codiexpandido, '') <> '' ORDER BY codiexpandido
    `.execute(db)).rows.map((p) => ({
      codplanocontas: Number(p.codplanocontas), codiexpandido: String(p.codiexpandido), descricao: String(p.descricao ?? ''),
      classe: (p.classe as string | null) ?? null, nivel: p.nivel == null ? BalanceteService.nivelDe(String(p.codiexpandido)) : Number(p.nivel),
    }));

    // roll-up por PREFIXO: a sintética soma tudo que começa com o seu código
    const linhas: Linha[] = plano.map((p) => {
      const prefixo = p.codiexpandido + '.';
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

    const ini = f.contaIni?.trim() ?? '';
    const fim = f.contaFim?.trim() ?? '';
    const saida = linhas.filter((l) =>
      l.nivel <= f.nivelMax
      && (ini === '' || (fim !== '' ? (l.codiexpandido >= ini && l.codiexpandido <= fim) : l.codiexpandido.startsWith(ini)))
      && (f.semMovimento || l.movimentada)
      && (f.analiticas || l.sintetica));

    const raizes = saida.filter((l) => l.nivel === 1);
    return {
      periodo: { ini: f.dataIni, fim: f.dataFim },
      linhas: saida,
      totais: {
        contas: saida.length, contasMovimentadas: linhas.filter((l) => l.movimentada && !l.sintetica).length,
        debito: r2(raizes.reduce((s, l) => s + l.debito, 0)), credito: r2(raizes.reduce((s, l) => s + l.credito, 0)),
        saldoAnterior: r2(raizes.reduce((s, l) => s + l.saldoAnterior, 0)), saldoAtual: r2(raizes.reduce((s, l) => s + l.saldoAtual, 0)),
      },
      criterio: { nivel: 'derivado do código expandido', rollup: 'por prefixo' },
    };
  }
}
