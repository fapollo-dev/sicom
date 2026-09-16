import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** os CFOPs de venda que o legado soma na perna da nota fiscal (`udmRelFaturamento.dfm:73`). */
const CFOP_VENDA = [5102, 6102, 5403, 6403, 5405, 6405];

/**
 * FATURAMENTO POR MÊS (`FRMRELFATURAMENTO`, `udmRelFaturamento`). Dossiê: `uRelFaturamento.md`.
 * **80 acessos, 7 operadores.**
 *
 * Quanto a loja faturou, mês a mês.
 *
 * ── ⚠️ O relatório do legado mostra 0,04% do faturamento deste cliente ─────────────────────────────────
 * O SQL original soma **duas** pernas: a **Redução Z** do ECF (`REDUCAOZ.VENDALIQ`) e as **notas fiscais**
 * de saída nos seis CFOPs de venda. Isso era certo na época do cupom fiscal de impressora — e deixou de ser
 * quando a loja passou a emitir **NFC-e**.
 *
 * Medido na produção em 16/09/2026, agosto/2026:
 *
 * | perna | valor |
 * |---|---|
 * | `REDUCAOZ` | **0 linhas na tabela inteira** — o cliente não usa ECF |
 * | `NF` nos 6 CFOPs | 2 notas, **R$ 872,74** |
 * | **venda NFC-e** (`vendas`, 200.550 itens) | **R$ 2.233.973,50** |
 *
 * O relatório entregaria **872,74** onde o faturamento foi **2,23 milhões**. Não é arredondamento: é a tela
 * inteira olhando para um canal que a loja não usa mais.
 *
 * Aqui há **três pernas**, e a tela mostra cada uma: Redução Z (para quem ainda tem ECF), nota fiscal e
 * **NFC-e**. Não há dupla contagem — medido: as vendas são 100% `venda_nfc = 'S'` (modelo 65) e as notas de
 * saída do mês são todas **modelo 55**. São canais distintos.
 */
@Injectable()
export class RelFaturamentoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: { dataIni: string; dataFim: string }): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { reducaoz: number; notaFiscal: number; nfce: number; total: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    if (f.dataIni > f.dataFim) throw new BusinessRuleError('DATA_INICIAL_MAIOR', { dataIni: f.dataIni, dataFim: f.dataFim });

    const linhas = (await sql<Record<string, unknown>>`
      WITH meses AS (
        -- perna 1: a REDUÇÃO Z do ECF. Zero neste cliente, mantida para quem ainda usa cupom de impressora.
        SELECT date_trunc('month', r.data)::date AS mes,
               coalesce(sum(r.vendaliq), 0) AS reducaoz, 0::numeric AS nota_fiscal, 0::numeric AS nfce
          FROM reducaoz r
         WHERE r.idempresa = ${emp}
           AND r.data::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         GROUP BY 1
        UNION ALL
        -- perna 2: as NOTAS FISCAIS de saída, nos seis CFOPs de venda
        SELECT date_trunc('month', n.dtemissao)::date, 0, coalesce(sum(n.totalnf), 0), 0
          FROM nf n
         WHERE n.idempresa = ${emp}
           AND n.dtemissao::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           AND n.cfop::integer = ANY(${CFOP_VENDA})
           AND coalesce(n.cancelada, 'N') = 'N'
           AND coalesce(n.proc, 'N') = 'S'
         GROUP BY 1
        UNION ALL
        -- ⚠️ perna 3, que NÃO existe no legado: a venda NFC-e. É de onde vem o faturamento hoje.
        SELECT date_trunc('month', v.dtvenda)::date, 0, 0,
               coalesce(sum(CASE WHEN v.iat = 'A' THEN round((v.qtde * v.vrvenda)::numeric, 2)
                                 ELSE trunc((v.qtde * v.vrvenda)::numeric * 100) / 100 END), 0)
          FROM vendas v
         WHERE v.idempresa = ${emp}
           AND v.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           AND coalesce(v.cancelado, 'N') = 'N'
         GROUP BY 1
      )
      SELECT to_char(m.mes, 'YYYY-MM') AS competencia,
             extract(month FROM m.mes)::int AS mes,
             extract(year FROM m.mes)::int AS ano,
             m.mes AS d1,
             (m.mes + interval '1 month' - interval '1 day')::date AS d2,
             round(sum(m.reducaoz)::numeric, 2)    AS reducaoz,
             round(sum(m.nota_fiscal)::numeric, 2) AS nota_fiscal,
             round(sum(m.nfce)::numeric, 2)        AS nfce,
             round(sum(m.reducaoz + m.nota_fiscal + m.nfce)::numeric, 2) AS venda_liquida
        FROM meses m
       GROUP BY m.mes
       ORDER BY m.mes
       LIMIT 601
    `.execute(db)).rows;

    return {
      linhas,
      totais: {
        reducaoz: r2(linhas.reduce((s, l) => s + num(l.reducaoz), 0)),
        notaFiscal: r2(linhas.reduce((s, l) => s + num(l.nota_fiscal), 0)),
        nfce: r2(linhas.reduce((s, l) => s + num(l.nfce), 0)),
        total: r2(linhas.reduce((s, l) => s + num(l.venda_liquida), 0)),
      },
    };
  }
}
