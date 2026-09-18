import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ConsultaProdutosDto, KardexProdutoDto, PosicaoProdutoDto, OrigemMovimento } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * CONSULTA DE PRODUTOS (`FRMCONSPROD`) + ANÁLISE GERAL DO PRODUTO (`FRMPOSICAOPRODUTO`).
 * **25 acessos, 8 operadores** na consulta. Dossiê: `uConsProd.md`. Migration 249.
 *
 * A consulta acha o produto pelos três caminhos num campo só (descrição LIKE, código de barras =, código =) e
 * mostra o que a `get_produtos` não traz: os preços. De dentro dela abre a análise geral — a visão 360 do
 * produto: cabeçalho, escada de custo→lucro líquido, estoque e preço por loja, movimento em quatro janelas
 * (mês, semana, dia, ano), entradas, compras, pedidos pendentes e Kardex.
 *
 * ── A escada é LIDA, não calculada ──────────────────────────────────────────────────────────────────────
 * Os 12 degraus vêm gravados em `multi_preco` pela precificação (`FRMPRIFICACAOCUSTO`, migration 129). Esta
 * tela é a leitura da foto, não um segundo motor de cálculo — se recalculasse, divergiria do que foi gravado.
 *
 * ── Os quatro quadros saem da venda, não de cache ───────────────────────────────────────────────────────
 * O legado lê `MOVIMENTOS_VENDAS` e `SELECT_PEDIDOS`, tabelas materializadas por job de madrugada. Medido no
 * cliente (loja 1): em ago/2026, mês FECHADO, a cache marca **141.157,174 un** e a venda real **140.930,659** —
 * 226,5 a mais; em 2025, **620,35** a mais. A cache congelou vendas canceladas depois do job e nunca
 * reprocessa o passado. No mês corrente, 237 de 3.147 produtos (7,5%) divergem. Aqui tudo sai das tabelas.
 *
 * ── Um critério de cancelado só ─────────────────────────────────────────────────────────────────────────
 * O legado exige `cancelado = 'N'` no quadro mensal e aceita `= 'N' or is null` no diário — os **33 pedidos**
 * com CANCELADO nulo em produção entram num e somem do outro. Aqui: `coalesce(cancelado,'N') <> 'S'`, sempre.
 *
 * ── O modo "Pedidos" do legado está quebrado em dois lugares ────────────────────────────────────────────
 * (a) três dos quatro quadros ignoram a escolha e continuam lendo venda; (b) o único que respeita aplica
 * `v.tipo = 'P'`, e `PEDIDOS.TIPO` é NULL em **36.887 dos 37.080** (99,5%). Aqui `origem` vale para os quatro
 * quadros e não filtra por TIPO.
 */
@Injectable()
export class PosicaoProdutoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** FRMCONSPROD: descrição (LIKE), código de barras (=) ou código (=) — os três no mesmo termo. */
  async consultar(f: ConsultaProdutosDto): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const termo = f.termo.trim();
    // o EAN também é só dígitos, e de 13 estoura o integer do Postgres — código é o que couber em int4
    const cod = /^\d{1,9}$/.test(termo) ? Number(termo) : null;

    const rows = (await sql<Record<string, unknown>>`
      SELECT p.idproduto, p.codbarra, p.descricao, p.unidade,
             coalesce(m.vrcusto, 0)     AS vrcusto,
             coalesce(m.vrcustoreal, 0) AS vrcustoreal,
             coalesce(m.vrpromo, 0)     AS vrpromo,
             coalesce(m.vrvenda, 0)     AS vrvenda,
             coalesce(m.promocao, 'N')  AS promocao,
             f.razao AS fornecedor
        FROM produtos p
        LEFT JOIN parceiros   f ON f.codparceiro = p.codfor
        LEFT JOIN multi_preco m ON m.idproduto = p.idproduto AND m.idempresa = ${emp}
       WHERE upper(p.descricao) LIKE upper(${'%' + termo + '%'})
          OR p.codbarra = ${termo}
          OR p.idproduto = coalesce(${cod}::integer, -1)
       ORDER BY p.descricao
       LIMIT ${f.limite}
    `.execute(db)).rows;

    return rows.map((r) => ({
      idproduto: Number(r.idproduto),
      codbarra: r.codbarra,
      descricao: r.descricao,
      unidade: r.unidade,
      vrcusto: r2(num(r.vrcusto)),
      vrcustoreal: r2(num(r.vrcustoreal)),
      vrpromo: r2(num(r.vrpromo)),
      vrvenda: r2(num(r.vrvenda)),
      promocao: r.promocao,
      fornecedor: r.fornecedor ?? null,
    }));
  }

  /**
   * Fragmento do movimento conforme a origem escolhida. 'V' vendas, 'P' pedidos, 'T' os dois — e o critério de
   * cancelado é o mesmo nos três, ao contrário do legado.
   */
  private movimento(origem: OrigemMovimento, emp: number, idproduto: number) {
    const vendas = sql`
      SELECT v.dtvenda AS data, v.qtde AS qtde
        FROM vendas v
       WHERE v.codproduto = ${idproduto} AND v.idempresa = ${emp}
         AND coalesce(v.cancelado, 'N') <> 'S'`;
    const pedidos = sql`
      SELECT p.dtvenda AS data, p.qtde AS qtde
        FROM pedidos p
       WHERE p.codproduto = ${idproduto} AND p.idempresa = ${emp}
         AND coalesce(p.cancelado, 'N') <> 'S'`;
    if (origem === 'V') return vendas;
    if (origem === 'P') return pedidos;
    return sql`${vendas} UNION ALL ${pedidos}`;
  }

  async posicao(f: PosicaoProdutoDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const id = f.idproduto;
    const ref = f.referencia ?? null;
    const mov = this.movimento(f.origem, emp, id);

    // ── cabeçalho + escada (a foto gravada pela precificação) ──────────────────────────────────────────
    const cab = (await sql<Record<string, unknown>>`
      SELECT p.idproduto, p.codbarra, p.descricao, p.unidade, p.aliquota,
             g.descricao AS subgrupo, f.razao AS fornecedor,
             coalesce(m.vrcusto, 0) AS vrcusto, coalesce(m.vrcustoreal, 0) AS vrcustoreal,
             coalesce(m.vrpromo, 0) AS vrpromo, coalesce(m.vrvenda, 0) AS vrvenda,
             coalesce(m.promocao, 'N') AS promocao, coalesce(m.markup, 0) AS markup,
             m.icmst, m.ipi, m.frete, m.despacessorio, m.seguro, a.icm_efetivo,
             coalesce(m.creditoicm, 0) AS creditoicm, coalesce(m.creditopiscofins, 0) AS creditopiscofins,
             coalesce(m.debitoicm, 0) AS debitoicm, coalesce(m.debitopiscofins, 0) AS debitopiscofins,
             coalesce(m.vendaliq, 0) AS vendaliq, coalesce(m.lucrobrutov, 0) AS lucrobrutov,
             coalesce(m.despopv, 0) AS despopv, coalesce(m.lucroliqv, 0) AS lucroliqv,
             coalesce(m.imprend, 0) AS imprend, coalesce(m.contsocial, 0) AS contsocial,
             coalesce(m.margeml2v, 0) AS margeml2v, coalesce(m.margeml2, 0) AS margeml2
        FROM produtos p
        LEFT JOIN familias_prod g ON g.codfamilia = p.codsubgrupo
        LEFT JOIN parceiros     f ON f.codparceiro = p.codfor
        LEFT JOIN multi_preco   m ON m.idproduto = p.idproduto AND m.idempresa = ${emp}
        LEFT JOIN det_aliquota  a ON a.aliquota = p.aliquota AND a.uf = (SELECT e.uf FROM empresas e WHERE e.idempresa = ${emp})
       WHERE p.idproduto = ${id}
    `.execute(db)).rows[0];
    if (!cab) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO');

    // ── estoque e preço por loja (é para isto que o legado usava o multi-empresa) ───────────────────────
    const lojas = (await sql<Record<string, unknown>>`
      SELECT e.idempresa, e.qtde,
             coalesce(d.qtde, 0) AS qtde_dep,
             coalesce(mp.vrcusto, 0) AS vrcusto, coalesce(mp.vrvenda, 0) AS vrvenda
        FROM estoque e
        LEFT JOIN estoque_dep d  ON d.idproduto = e.idproduto AND d.idempresa = e.idempresa
        LEFT JOIN multi_preco mp ON mp.idproduto = e.idproduto AND mp.idempresa = e.idempresa
       WHERE e.idproduto = ${id}
       ORDER BY e.idempresa
    `.execute(db)).rows;

    // ── 13 meses (o legado: StartOfAMonth(Y-1,M) .. EndOfAMonth(Y,M)) ──────────────────────────────────
    const mensal = (await sql<Record<string, unknown>>`
      WITH ref AS (SELECT coalesce(${ref}::date, current_date) AS d),
           mov AS (${mov})
      SELECT to_char(date_trunc('month', m.data), 'MM/YYYY') AS periodo,
             extract(month from m.data)::int AS mes, extract(year from m.data)::int AS ano,
             sum(m.qtde) AS qtde
        FROM mov m, ref r
       WHERE m.data >= date_trunc('month', r.d) - interval '12 months'
         AND m.data <  date_trunc('month', r.d) + interval '1 month'
       GROUP BY date_trunc('month', m.data), extract(month from m.data), extract(year from m.data)
       ORDER BY 3 DESC, 2 DESC
    `.execute(db)).rows;

    // ── últimos 8 dias (o legado: Now-7 .. Now, BETWEEN inclusivo) ─────────────────────────────────────
    const diario = (await sql<Record<string, unknown>>`
      WITH ref AS (SELECT coalesce(${ref}::date, current_date) AS d),
           mov AS (${mov})
      SELECT to_char(m.data::date, 'YYYY-MM-DD') AS data, sum(m.qtde) AS qtde
        FROM mov m, ref r
       WHERE m.data::date BETWEEN r.d - 7 AND r.d
       GROUP BY m.data::date
       ORDER BY m.data::date DESC
    `.execute(db)).rows;

    // ── 5 semanas domingo→sábado (o legado conta a partir do DayOfWeek do Delphi: 1 = domingo) ──────────
    const semanal = (await sql<Record<string, unknown>>`
      WITH ref AS (SELECT coalesce(${ref}::date, current_date) AS d),
           dom AS (SELECT r.d, r.d - extract(dow from r.d)::int AS domingo FROM ref r),
           sem AS (SELECT s.i + 1 AS ordem, dom.domingo - (s.i * 7) AS ini, dom.domingo - (s.i * 7) + 6 AS fim
                     FROM dom, generate_series(0, 4) AS s(i)),
           mov AS (${mov})
      SELECT sem.ordem, to_char(sem.ini, 'YYYY-MM-DD') AS ini, to_char(sem.fim, 'YYYY-MM-DD') AS fim,
             coalesce(sum(m.qtde), 0) AS qtde
        FROM sem
        LEFT JOIN mov m ON m.data::date BETWEEN sem.ini AND sem.fim
       GROUP BY sem.ordem, sem.ini, sem.fim
       ORDER BY sem.ordem
    `.execute(db)).rows;

    // ── série anual COMPLETA: a cache do legado só guarda de 2025-01 e escondia sete anos de venda ──────
    const anual = (await sql<Record<string, unknown>>`
      WITH mov AS (${mov})
      SELECT extract(year from m.data)::int AS ano, sum(m.qtde) AS qtde
        FROM mov m GROUP BY extract(year from m.data) ORDER BY 1
    `.execute(db)).rows;

    // ── entradas por mês (NF de entrada processada) ────────────────────────────────────────────────────
    const entradas = (await sql<Record<string, unknown>>`
      WITH ref AS (SELECT coalesce(${ref}::date, current_date) AS d)
      SELECT to_char(date_trunc('month', v.dtcontabil), 'MM/YYYY') AS periodo,
             extract(month from v.dtcontabil)::int AS mes, extract(year from v.dtcontabil)::int AS ano,
             sum(np.fatorembal * np.quantidade) AS qtde
        FROM nf v
        JOIN nf_prod np ON np.codnf = v.codnf
        CROSS JOIN ref r
       WHERE np.codproduto = ${id} AND v.idempresa = ${emp} AND v.tipo = 'E' AND v.proc = 'S'
         AND v.dtcontabil >= date_trunc('month', r.d) - interval '12 months'
         AND v.dtcontabil <  date_trunc('month', r.d) + interval '1 month'
       GROUP BY date_trunc('month', v.dtcontabil), extract(month from v.dtcontabil), extract(year from v.dtcontabil)
       ORDER BY 3 DESC, 2 DESC
    `.execute(db)).rows;

    // ── compras por mês (pedido de compra; no destino a quantidade é o fatorembalagem do item) ──────────
    const compras = (await sql<Record<string, unknown>>`
      WITH ref AS (SELECT coalesce(${ref}::date, current_date) AS d)
      SELECT to_char(date_trunc('month', pc.data), 'MM/YYYY') AS periodo,
             extract(month from pc.data)::int AS mes, extract(year from pc.data)::int AS ano,
             sum(i.fatorembalagem) AS qtde
        FROM pedidocompra pc
        JOIN pedidocompra_i i ON i.codpedcomp = pc.codpedcomp
        CROSS JOIN ref r
       WHERE i.idproduto = ${id} AND pc.idempresa = ${emp}
         AND coalesce(pc.indr, 'A') <> 'E' AND coalesce(i.indr, 'A') <> 'E'
         AND pc.data >= date_trunc('month', r.d) - interval '12 months'
         AND pc.data <  date_trunc('month', r.d) + interval '1 month'
       GROUP BY date_trunc('month', pc.data), extract(month from pc.data), extract(year from pc.data)
       ORDER BY 3 DESC, 2 DESC
    `.execute(db)).rows;

    // ── pedidos de compra ainda abertos (o legado: COALESCE(Q.FECHADO,'N') = 'N') ───────────────────────
    const pendentes = (await sql<Record<string, unknown>>`
      SELECT pc.codpedcomp AS nropedido, to_char(pc.data, 'YYYY-MM-DD') AS dtpedido,
             i.fatorembalagem AS qtde, pc.codparceiro AS codfor, f.razao
        FROM pedidocompra pc
        JOIN pedidocompra_i i ON i.codpedcomp = pc.codpedcomp
        LEFT JOIN parceiros f ON f.codparceiro = pc.codparceiro
       WHERE i.idproduto = ${id} AND pc.idempresa = ${emp}
         AND coalesce(pc.fechado, 'N') = 'N'
         AND coalesce(pc.indr, 'A') <> 'E' AND coalesce(i.indr, 'A') <> 'E'
         AND i.fatorembalagem > 0
       ORDER BY pc.data DESC
    `.execute(db)).rows;

    const serie = (rs: Record<string, unknown>[]) =>
      rs.map((r) => ({ ...r, qtde: r3(num(r.qtde)), mes: r.mes == null ? undefined : Number(r.mes), ano: r.ano == null ? undefined : Number(r.ano) }));

    return {
      produto: {
        idproduto: Number(cab.idproduto), codbarra: cab.codbarra, descricao: cab.descricao,
        unidade: cab.unidade, aliquota: cab.aliquota, subgrupo: cab.subgrupo ?? null,
        fornecedor: cab.fornecedor ?? null, promocao: cab.promocao,
      },
      custo: {
        vrcusto: r2(num(cab.vrcusto)), vrcustoreal: r2(num(cab.vrcustoreal)),
        frete: r2(num(cab.frete)), ipi: r2(num(cab.ipi)), icmst: r2(num(cab.icmst)),
        despacessorio: r2(num(cab.despacessorio)), seguro: r2(num(cab.seguro)),
        icmEfetivo: r2(num(cab.icm_efetivo)),
        creditoicm: r2(num(cab.creditoicm)), creditopiscofins: r2(num(cab.creditopiscofins)),
      },
      venda: {
        vrvenda: r2(num(cab.vrvenda)), vrpromo: r2(num(cab.vrpromo)), markup: r2(num(cab.markup)),
        debitoicm: r2(num(cab.debitoicm)), debitopiscofins: r2(num(cab.debitopiscofins)),
        vendaliq: r2(num(cab.vendaliq)), lucrobrutov: r2(num(cab.lucrobrutov)),
        despopv: r2(num(cab.despopv)), lucroliqv: r2(num(cab.lucroliqv)),
        imprend: r2(num(cab.imprend)), contsocial: r2(num(cab.contsocial)),
        margeml2v: r2(num(cab.margeml2v)), margeml2: r2(num(cab.margeml2)),
      },
      lojas: lojas.map((l) => ({
        idempresa: Number(l.idempresa), qtde: r3(num(l.qtde)), qtdeDeposito: r3(num(l.qtde_dep)),
        vrcusto: r2(num(l.vrcusto)), vrvenda: r2(num(l.vrvenda)),
      })),
      mensal: serie(mensal),
      diario: diario.map((r) => ({ data: r.data, qtde: r3(num(r.qtde)) })),
      semanal: semanal.map((r) => ({ ordem: Number(r.ordem), ini: r.ini, fim: r.fim, qtde: r3(num(r.qtde)) })),
      anual: anual.map((r) => ({ ano: Number(r.ano), qtde: r3(num(r.qtde)) })),
      entradas: serie(entradas),
      compras: serie(compras),
      pendentes: pendentes.map((r) => ({
        nropedido: Number(r.nropedido), dtpedido: r.dtpedido, qtde: r3(num(r.qtde)),
        codfor: r.codfor == null ? null : Number(r.codfor), razao: r.razao ?? null,
      })),
      totais: {
        mensal: r3(mensal.reduce((a, r) => a + num(r.qtde), 0)),
        semanal: r3(semanal.reduce((a, r) => a + num(r.qtde), 0)),
        entradas: r3(entradas.reduce((a, r) => a + num(r.qtde), 0)),
        // a "média anual" do legado: a média dos anos que têm movimento
        mediaAnual: anual.length === 0 ? 0 : r3(anual.reduce((a, r) => a + num(r.qtde), 0) / anual.length),
      },
    };
  }

  /** Ficha Kardex: entradas e saídas do estoque no período (`historico_prod`). */
  async kardex(f: KardexProdutoDto): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await sql<Record<string, unknown>>`
      SELECT h.codmov, to_char(h.data, 'YYYY-MM-DD HH24:MI') AS data,
             CASE WHEN h.tipo = 'E' THEN h.qtde ELSE 0 END AS entrada,
             CASE WHEN h.tipo = 'E' THEN 0 ELSE h.qtde END AS saida,
             h.saldo_novo AS qtde_atual, h.historico, h.origem, h.codnf,
             p.codbarra, p.descricao, p.unidade
        FROM historico_prod h
        LEFT JOIN produtos p ON p.idproduto = h.idproduto
       WHERE h.idproduto = ${f.idproduto} AND h.idempresa = ${emp}
         AND h.data >= ${f.dataIni}::date AND h.data < ${f.dataFim}::date + 1
       ORDER BY h.data, h.codmov
       LIMIT ${f.limite}
    `.execute(db)).rows;

    return rows.map((r) => ({
      codmov: Number(r.codmov), data: r.data,
      entrada: r3(num(r.entrada)), saida: r3(num(r.saida)), qtdeAtual: r3(num(r.qtde_atual)),
      historico: r.historico ?? null, origem: r.origem, codnf: r.codnf == null ? null : Number(r.codnf),
      codbarra: r.codbarra, descricao: r.descricao, unidade: r.unidade,
    }));
  }
}
