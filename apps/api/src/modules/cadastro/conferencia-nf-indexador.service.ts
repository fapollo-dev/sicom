import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroConferenciaNf {
  dataIni: string;
  dataFim: string;
  tipo?: 'E' | 'S' | null;
  nronf?: string | null;
  codparceiro?: number | null;
  produto?: string | null;
  incluirProcessadas?: boolean;
  incluirCanceladas?: boolean;
  /** só o que diverge — é para isso que a tela existe. */
  somenteDivergentes?: boolean;
}

/**
 * CONFERÊNCIA DE NOTA FISCAL × INDEXADOR TRIBUTÁRIO (`FRMCONFERENCIANFINDEXADOR`,
 * `uConferenciaNFIndexador.pas` 685 linhas). Dossiê: `uConferenciaNFIndexador.md`. **165 acessos.**
 *
 * Põe lado a lado, item a item, **o que o sistema calculou** e **o que veio na nota**. É onde se descobre
 * que o fornecedor mandou um CST diferente do cadastrado, ou um total que não fecha com quantidade × custo.
 *
 * O lado "sistema" é derivado: as colunas de encargo em `nf_prod` são **percentuais**, e o legado os aplica
 * sobre a base líquida do item (`uDMConferenciaNFIndexador.dfm:30`):
 * ```
 * base = QUANTIDADE × (VRCUSTO − VRDESCPROD / QUANTIDADE)
 * IPI  = IPI% > 0 ? round(IPI%/100 × base, 2) : 0        (idem seguro, frete, acessórias)
 * ```
 * O lado "nota" são as colunas `*_NOTA`, extraídas do XML na importação — as 19 que a mig 215 trouxe.
 *
 * Três defaults do legado que valem regra, e não são óbvios (`:70-95`):
 *  · `TOTAL_PRODUTO_NOTA` **zerado vale `QUANTIDADE × VRCUSTO`** — nota antiga, importada antes de a coluna
 *    existir, não aparece como divergência gigante;
 *  · `QTD_NOTA` zerada vale `QUANTIDADE`, pelo mesmo motivo;
 *  · o **valor unitário da nota** é `TOTAL_PRODUTO_NOTA / QUANTIDADE` — repare que divide pela quantidade do
 *    SISTEMA, não pela `QTD_NOTA`. Está assim no fonte, e é o número que o conferente lê há anos.
 *
 * ⚠️ **as divisões do legado não têm proteção**: `VRDESCPROD / QUANTIDADE` e
 * `VRDESCPROD / (QUANTIDADE × VRCUSTO)`. Em produção há **4 itens com quantidade zero** e **6 com base
 * zero** — no legado a linha inteira vira NULL e some da conferência, que é o pior lugar possível para uma
 * linha sumir. Aqui as divisões usam `NULLIF` e o item aparece, com o encargo em zero.
 */
@Injectable()
export class ConferenciaNfIndexadorService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async listar(f: FiltroConferenciaNf): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { itens: number; divergentes: number; divergenciaValor: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    if (f.dataIni > f.dataFim) throw new BusinessRuleError('DATA_INICIAL_MAIOR', { dataIni: f.dataIni, dataFim: f.dataFim });

    const onde = [
      sql`nf.idempresa = ${emp}`,
      sql`nf.dtemissao::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`,
    ];
    if (f.tipo) onde.push(sql`nf.tipo = ${f.tipo}`);
    if (f.nronf) onde.push(sql`nf.nronf LIKE ${`%${f.nronf}%`}`);
    if (f.codparceiro) onde.push(sql`nf.codparceiro = ${f.codparceiro}`);
    // o legado aceita descrição OU código de barras no mesmo campo ("Código ou Cód. Barra")
    if (f.produto) onde.push(sql`(pr.descricao ILIKE ${`%${f.produto}%`} OR pr.codbarra = ${f.produto} OR p.codprodnota = ${f.produto})`);
    // as duas caixas do legado são de INCLUSÃO: desmarcadas, escondem
    if (!f.incluirProcessadas) onde.push(sql`coalesce(nf.proc, 'N') = 'N'`);
    if (!f.incluirCanceladas) onde.push(sql`coalesce(nf.cancelada, 'N') = 'N'`);

    // a base líquida do item, com NULLIF onde o legado divide sem proteção
    const base = sql`(p.quantidade * (p.vrcusto - (coalesce(p.vrdescprod, 0) / nullif(p.quantidade, 0))))`;
    const pct = (col: string) => sql`
      CASE WHEN coalesce(p.${sql.ref(col)}, 0) > 0
           THEN round(((coalesce(p.${sql.ref(col)}, 0) / 100) * coalesce(${base}, 0))::numeric, 2)
           ELSE 0 END`;

    const linhas = (await sql<Record<string, unknown>>`
      SELECT nf.codnf, nf.nronf, nf.tipo, to_char(nf.dtemissao, 'YYYY-MM-DD') AS dtemissao,
             to_char(nf.dtimportacao, 'YYYY-MM-DD') AS dtimportacao,
             coalesce(nf.proc, 'N') AS proc, coalesce(nf.cancelada, 'N') AS cancelada,
             pa.codparceiro, pa.razao AS fornecedor,
             p.codnfprod, p.codproduto, p.codprodnota, pr.descricao, pr.codbarra,
             p.quantidade, p.vrcusto, p.vrvenda,
             ${pct('ipi')}       AS ipi,
             ${pct('seguro')}    AS seguro,
             ${pct('frete')}     AS frete,
             ${pct('depsacess')} AS despesas_acessorias,
             coalesce(p.desconto, 0) AS desconto,
             coalesce(p.vrdescprod, 0) AS desconto_total,
             coalesce(p.vrdescprod, 0) / nullif(p.quantidade * p.vrcusto, 0) AS desconto_qtde,
             coalesce(p.vroutrasdesp, 0) AS vroutrasdesp,
             p.cst, p.cfop,
             coalesce(p.ipi_nota, 0)             AS ipi_nota,
             coalesce(p.seguro_nota, 0)          AS seguro_nota,
             coalesce(p.frete_nota, 0)           AS frete_nota,
             coalesce(p.desconto_nota, 0)        AS desconto_nota,
             coalesce(p.outras_despesas_nota, 0) AS outras_despesas_nota,
             p.cst_nota, p.cfop_original AS cfop_nota, p.mva_ajustado,
             coalesce(p.icms_aliq_nota, 0)       AS icms_aliq_nota,
             coalesce(p.icms_nota_valor, 0)      AS icms_nota_valor,
             coalesce(p.icms_nota_bc, 0)         AS icms_nota_bc,
             coalesce(p.icms_red_bc_nota, 0)     AS icms_red_bc_nota,
             coalesce(p.icms_st_aliq_nota, 0)    AS icms_st_aliq_nota,
             coalesce(p.icms_st_bc_nota, 0)      AS icms_st_bc_nota,
             CASE WHEN coalesce(p.total_produto_nota, 0) = 0
                  THEN (p.quantidade * p.vrcusto) ELSE p.total_produto_nota END AS total_produto_nota,
             CASE WHEN coalesce(p.qtd_nota, 0) = 0 THEN p.quantidade ELSE p.qtd_nota END AS qtd_nota,
             CASE WHEN coalesce(p.total_produto_nota, 0) > 0
                  THEN (p.total_produto_nota / nullif(p.quantidade, 0)) ELSE p.vrcusto END AS vr_unit_prod_nota,
             CASE WHEN coalesce(p.qtd_nota, 0) > 0
                  THEN coalesce(p.total_produto_nota, 0) / p.qtd_nota ELSE 0 END AS desconto_nota_item
        FROM nf_prod p
        JOIN nf nf            ON nf.codnf = p.codnf
        LEFT JOIN produtos pr ON pr.idproduto = p.codproduto
        LEFT JOIN parceiros pa ON pa.codparceiro = nf.codparceiro
       WHERE ${sql.join(onde, sql` AND `)}
       ORDER BY nf.dtemissao DESC, nf.nronf, pr.descricao
       LIMIT 5001
    `.execute(db)).rows;

    // as divergências, marcadas coluna a coluna — é o que o conferente procura
    const comparar: Array<[string, string, string]> = [
      ['total', 'total_sistema', 'total_produto_nota'],
      ['ipi', 'ipi', 'ipi_nota'],
      ['seguro', 'seguro', 'seguro_nota'],
      ['frete', 'frete', 'frete_nota'],
      ['desconto', 'desconto_total', 'desconto_nota'],
      ['acessorias', 'despesas_acessorias', 'outras_despesas_nota'],
    ];
    const linhasMarcadas = linhas.map((l) => {
      const totalSistema = r2(num(l.quantidade) * num(l.vrcusto));
      const alvo = { ...l, total_sistema: totalSistema } as Record<string, unknown>;
      const divs: string[] = [];
      for (const [nome, a, b] of comparar) {
        if (Math.abs(num(alvo[a]) - num(alvo[b])) > 0.01) divs.push(nome);
      }
      // CST é código: comparação textual, e nulo dos dois lados não é divergência
      if (String(l.cst ?? '') !== String(l.cst_nota ?? '')) divs.push('cst');
      alvo.divergencias = divs;
      alvo.divergente = divs.length > 0;
      alvo.divergencia_valor = r2(num(alvo.total_produto_nota) - totalSistema);
      return alvo;
    });

    const filtradas = f.somenteDivergentes ? linhasMarcadas.filter((l) => l.divergente) : linhasMarcadas;
    return {
      linhas: filtradas,
      totais: {
        itens: filtradas.length,
        divergentes: linhasMarcadas.filter((l) => l.divergente).length,
        divergenciaValor: r2(filtradas.reduce((s, l) => s + num(l.divergencia_valor), 0)),
      },
    };
  }
}
