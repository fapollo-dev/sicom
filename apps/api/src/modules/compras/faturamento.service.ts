import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { situacaoParcela, type FaturamentoDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * FATURAMENTO DA NOTA (`FRMFATURAMENTO2`). **34 acessos, 8 operadores.**
 * Dossiê: `uFaturamento2.md`. Migration 246.
 *
 * As **parcelas** de cada nota: quando vencem, quanto, e se já viraram título no financeiro. É a ponte entre
 * a nota e o financeiro, e a tela que diz o que está **vencendo hoje**, o que **atrasou** e o que já foi
 * **faturado** — a legenda de três cores do original.
 *
 * No cliente: **47.063 parcelas** em 42.502 notas, **R$ 125.733.363,04**, 7.472 só em 2026.
 *
 * ── Cópia-fiel-negativa, medida ───────────────────────────────────────────────────────────────────────
 * ⚠️ `TIPOREF` — o "destino" (APG/RCB/CHQ/KXP/KXR) que a aba de movimento mostra — é **nulo nas 47.063
 *    linhas**, e `LOTE_FATURAMENTO`/`_DETALHE` têm **0 linhas**. A aba não tem substrato; o corte cobre a
 *    consulta das parcelas, que é o que o operador usa.
 * ⚠️ **duas grafias para a mesma modalidade**: `A PAGAR` (45.897) e `APAGAR` (7). A consulta normaliza para
 *    agrupar, mas mostra o que está gravado — corrigir o dado é outra conversa.
 * ⚠️ **5 parcelas com o ano digitado errado** (202, 2202, 5202), R$ 11.193,35: o legado aceita qualquer data.
 *    A consulta as traz (escondê-las falsearia o total) e a tela as marca.
 */
@Injectable()
export class FaturamentoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async listar(f: FaturamentoDto): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { parcelas: number; notas: number; valor: number; vencendoHoje: number; atrasadas: number; faturadas: number; dataInvalida: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const base = f.base === 'EMISSAO' ? sql`n.dtemissao`
      : f.base === 'CONTABIL' ? sql`n.dtcontabil` : sql`ft.data`;
    const lib = f.liberado === 'N' ? sql`AND coalesce(ft.liberado, 'N') <> 'S'`
      : f.liberado === 'S' ? sql`AND ft.liberado = 'S'` : sql``;

    const linhas = (await sql<Record<string, unknown>>`
      SELECT ft.codfaturamento, ft.idnf, n.nronf, n.serie, n.tipo,
             coalesce(p.razao, '(sem parceiro)') AS titular,
             n.totalnf, n.dtemissao, n.dtcontabil,
             -- a data sai como texto ISO: a situação é comparação de datas, não de objetos
             to_char(ft.data, 'YYYY-MM-DD') AS vencimento, ft.data AS vencimento_data,
             ft.valor, coalesce(ft.liberado, 'N') AS liberado,
             -- ⚠️ 'A PAGAR' e 'APAGAR' são a mesma modalidade no cliente (45.897 e 7)
             upper(replace(coalesce(ft.modalidade, ''), ' ', '')) AS modalidade_norm,
             ft.modalidade, ft.nrofatura, ft.totalparcelasfatura, ft.duplicata,
             ft.valor_desconto, ft.valor_bonificado, ft.codbarrasboleto, ft.obs
        FROM faturamento ft
        LEFT JOIN nf n        ON n.codnf = ft.idnf
        LEFT JOIN parceiros p ON p.codparceiro = n.codparceiro
       WHERE n.idempresa = ${emp}
         AND n.tipo = ${f.tipo}
         -- o legado só lista nota PROCESSADA ("COALESCE(N.PROC,'N') = 'S'")
         AND coalesce(n.proc, 'N') = 'S'
         AND ${base}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         ${lib}
         AND (${f.nronf ?? null}::text IS NULL OR n.nronf = ${f.nronf ?? null}::text)
         AND (${f.codparceiro ?? null}::int IS NULL OR n.codparceiro = ${f.codparceiro ?? null}::int)
       ORDER BY ft.data, p.razao, n.nronf, ft.nrofatura
       LIMIT ${f.limite}
    `.execute(db)).rows;

    const hoje = new Date().toISOString().slice(0, 10);
    const notas = new Set<number>();
    const t = { parcelas: linhas.length, notas: 0, valor: 0, vencendoHoje: 0, atrasadas: 0, faturadas: 0, dataInvalida: 0 };
    const saida = linhas.map((l) => {
      notas.add(Number(l.idnf));
      t.valor += num(l.valor);
      const sit = situacaoParcela(l.vencimento as string, l.liberado as string, hoje);
      if (sit === 'VENCE_HOJE') t.vencendoHoje += 1;
      else if (sit === 'ATRASADA') t.atrasadas += 1;
      else if (sit === 'FATURADA') t.faturadas += 1;
      // o ano fora de faixa é digitação errada, e o legado aceita
      const ano = l.vencimento ? Number(String(l.vencimento).slice(0, 4)) : null;
      const dataInvalida = ano != null && (ano < 2000 || ano > 2100);
      if (dataInvalida) t.dataInvalida += 1;
      return { ...l, situacao: sit, data_invalida: dataInvalida };
    });
    t.notas = notas.size;
    t.valor = r2(t.valor);
    return { linhas: saida, totais: t };
  }
}
