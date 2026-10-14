import { Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { ConfigService } from './config.service';

type AnyDB = Kysely<any>;
type Linha = Record<string, unknown>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type OrigemPosicao = 'V' | 'P' | 'T';

/**
 * POSIÇÃO DO PRODUTO — "[F7] - Análise geral do produto" do cadastro (`TfrmPosicaoProduto`, UPosicaoProduto.pas + UdmPosicaoProduto.dfm):
 * a consulta consolidada de um produto nas lojas escolhidas (o Ctrl+E do legado; a do login por padrão) — os dados do produto e do preço
 * (custo: frete, IPI, seguro, ICMS-ST, acessórias, ICM da UF da loja, créditos; venda: débitos, venda líquida, lucros, IR, CSLL, lucro
 * final — as colunas do MULTI_PRECO e o ICM_EFETIVO da DET_ALIQUOTA), custo/venda por loja, estoques por loja (loja + depósito) e os
 * resumos de movimento: mensal de saídas (de 12 meses atrás ao fim do mês), mensal de entradas (NF de entrada processada, qtde ×
 * fator), últimas 5 semanas (de domingo a sábado), últimos 7 dias, média anual (do 1º de janeiro do ano anterior até hoje), compras
 * (pedidos de compra do período) e os pedidos de compra pendentes. A origem das saídas é o rádio da tela: Vendas (VENDAS cancelado N),
 * Pedidos (PEDIDOS tipo P, cancelado N ou nulo) ou Todos (os dois somados — `ProcessarOpcaoTodos`).
 */
@Injectable()
export class ProdutoPosicaoService {
  constructor(private readonly dbp: DatabaseProvider, private readonly config: ConfigService) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async posicao(idproduto: number, f: { empresas?: number[] | null; origem?: OrigemPosicao }) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const empresas = await empresasDoOperador(db, f.empresas ?? null);
    const origem: OrigemPosicao = f.origem === 'P' || f.origem === 'T' ? f.origem : 'V';
    const tz = String((await this.config.resolver('FUSO_HORARIO_ACESSO', { empresaId: emp })) ?? 'America/Sao_Paulo');
    const tzLit = sql.lit(/^[A-Za-z0-9_/+-]+$/.test(tz) ? tz : 'America/Sao_Paulo');
    const dia = (col: string): RawBuilder<unknown> => sql`(${sql.ref(col)} AT TIME ZONE ${tzLit})::date`;
    const hojeStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const hoje = new Date(`${hojeStr}T00:00:00Z`);
    const y = hoje.getUTCFullYear(); const m = hoje.getUTCMonth(); // 0-11
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const addDias = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
    // StartOfAMonth(Y-1, M) .. EndOfAMonth(Y, M)
    const mesIni = iso(new Date(Date.UTC(y - 1, m, 1)));
    const mesFim = iso(new Date(Date.UTC(y, m + 1, 0)));

    const uf = String((await db.selectFrom('empresas').select('uf').where('idempresa', '=', emp).executeTakeFirst())?.uf ?? '');
    // sqqProdutos: o produto com o MULTI_PRECO das lojas escolhidas e o ICM efetivo da UF da loja do login — com mais de uma loja o legado
    // mostra a primeira linha do cursor (a de menor loja)
    const produto = (await sql<Linha>`
      SELECT p.idproduto, p.codbarra, p.descricao, p.unidade, g.descricao AS familia, f.razao AS fornecedor, m.idempresa,
             coalesce(m.vrcusto, 0) AS vrcusto, coalesce(m.vrcustoreal, 0) AS vrcustoreal, coalesce(m.vrpromo, 0) AS vrpromo, coalesce(m.vrvenda, 0) AS vrvenda,
             m.icmst, m.ipi, m.frete, m.despacessorio, coalesce(m.markup, 0) AS markup, m.seguro, coalesce(m.promocao, 'N') AS promocao, a.icm_efetivo,
             coalesce(m.creditoicm, 0) AS creditoicm, coalesce(m.creditopiscofins, 0) AS creditopiscofins, coalesce(m.debitoicm, 0) AS debitoicm,
             coalesce(m.debitopiscofins, 0) AS debitopiscofins, coalesce(m.vendaliq, 0) AS vendaliq, coalesce(m.lucrobrutov, 0) AS lucrobrutov,
             coalesce(m.despopv, 0) AS despopv, coalesce(m.lucroliqv, 0) AS lucroliqv, coalesce(m.imprend, 0) AS imprend, coalesce(m.contsocial, 0) AS contsocial,
             coalesce(m.margeml2v, 0) AS margeml2v, coalesce(m.margeml2, 0) AS margeml2
        FROM produtos p
        LEFT JOIN familias_prod g ON g.codfamilia = p.codsubgrupo
        LEFT JOIN parceiros f ON f.codparceiro = p.codfor
        LEFT JOIN multi_preco m ON m.idproduto = p.idproduto AND m.idempresa = ANY(${empresas}::int[])
        LEFT JOIN det_aliquota a ON a.aliquota = p.aliquota AND a.uf = ${uf}
       WHERE p.idproduto = ${idproduto}
       ORDER BY m.idempresa NULLS LAST
       LIMIT 1`.execute(db)).rows[0];
    if (!produto) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto });

    // sqqMultiPreco e sqqEstoque: todas as lojas (o legado não filtra)
    const lojas = (await sql<Linha>`SELECT idempresa, vrcusto, vrvenda FROM multi_preco WHERE idproduto = ${idproduto} ORDER BY idempresa`.execute(db)).rows;
    const estoques = (await sql<Linha>`
      SELECT e.idempresa, e.qtde, ed.qtde AS qtde_dep
        FROM produtos p JOIN estoque e ON e.idproduto = p.idproduto
        LEFT JOIN estoque_dep ed ON ed.idproduto = p.idproduto AND ed.idempresa = e.idempresa
       WHERE p.idproduto = ${idproduto} ORDER BY e.idempresa`.execute(db)).rows;

    // as saídas pela origem: VENDAS (cancelado N) e/ou PEDIDOS (tipo P na opção Pedidos; cancelado N ou nulo)
    const vendasDe = (de: string, ate: string, agrupar: RawBuilder<unknown>): RawBuilder<unknown> => sql`
      SELECT ${agrupar} AS k, sum(v.qtde) AS qtde FROM vendas v
       WHERE ${dia('v.dtvenda')} BETWEEN ${de}::date AND ${ate}::date AND v.idempresa = ANY(${empresas}::int[]) AND v.cancelado = 'N' AND v.codproduto = ${idproduto}
       GROUP BY ${agrupar}`;
    const pedidosDe = (de: string, ate: string, agrupar: RawBuilder<unknown>): RawBuilder<unknown> => sql`
      SELECT ${agrupar} AS k, sum(p.qtde) AS qtde FROM pedidos p
       WHERE ${dia('p.dtvenda')} BETWEEN ${de}::date AND ${ate}::date AND p.idempresa = ANY(${empresas}::int[]) AND (p.cancelado = 'N' OR p.cancelado IS NULL)
         ${origem === 'P' ? sql`AND p.tipo = 'P'` : sql``} AND p.codproduto = ${idproduto}
       GROUP BY ${agrupar}`;
    const saidas = async (de: string, ate: string, agrupaV: RawBuilder<unknown>, agrupaP: RawBuilder<unknown>): Promise<Map<string, number>> => {
      const tot = new Map<string, number>();
      const soma = async (q: RawBuilder<unknown>) => { for (const r of (await q.execute(db)).rows as Array<{ k: unknown; qtde: unknown }>) tot.set(String(r.k), r2((tot.get(String(r.k)) ?? 0) + num(r.qtde))); };
      if (origem !== 'P') await soma(vendasDe(de, ate, agrupaV));
      if (origem !== 'V') await soma(pedidosDe(de, ate, agrupaP));
      return tot;
    };
    const mesLabel = (col: string) => sql`extract(month from ${dia(col)})::int || '/' || extract(year from ${dia(col)})::int`;
    // resumo mensal de saídas (ano desc, mês desc) + total
    const mensalMap = await saidas(mesIni, mesFim, mesLabel('v.dtvenda'), mesLabel('p.dtvenda'));
    const ordemMes = (a: string, b: string) => { const [ma, ya] = a.split('/').map(Number); const [mb, yb] = b.split('/').map(Number); return yb - ya || mb - ma; };
    const mensal = [...mensalMap.entries()].sort(([a], [b]) => ordemMes(a, b)).map(([data, qtde]) => ({ data, qtde }));
    // últimos 7 dias (data desc)
    const diasMap = await saidas(iso(addDias(hoje, -7)), hojeStr, dia('v.dtvenda'), dia('p.dtvenda'));
    const dias = [...diasMap.entries()].map(([k, qtde]) => ({ data: String(k).slice(0, 10), qtde })).sort((a, b) => (a.data < b.data ? 1 : -1));
    // últimas 5 semanas, de domingo a sábado (DayOfWeek 1 = domingo): a 1ª é a semana corrente
    const dow = hoje.getUTCDay(); // 0 = domingo
    const domingo = addDias(hoje, -dow);
    const semanas: Array<{ semana: string; qtde: number }> = [];
    for (let i = 0; i < 5; i++) {
      const ini = addDias(domingo, -7 * i); const fim = i === 0 ? addDias(domingo, 6) : addDias(domingo, -7 * i + 6);
      const t = await saidas(iso(ini), iso(fim), sql`1`, sql`1`);
      semanas.push({ semana: `${i + 1}º SEMANA`, qtde: r2([...t.values()].reduce((s, v) => s + v, 0)) });
    }
    // média anual: por ano, do 1º de janeiro do ano anterior até hoje
    const anualMap = await saidas(`${y - 1}-01-01`, hojeStr, sql`extract(year from ${dia('v.dtvenda')})::int`, sql`extract(year from ${dia('p.dtvenda')})::int`);
    const anual = [...anualMap.entries()].map(([k, qtde]) => ({ ano: Number(k), qtde })).sort((a, b) => b.ano - a.ano);
    // sqqEntradas: NF de entrada processada, qtde × fator, por mês
    const entradas = (await sql<Linha>`
      SELECT extract(month from v.dtcontabil)::int || '/' || extract(year from v.dtcontabil)::int AS data, sum(np.fatorembal * np.quantidade) AS qtde
        FROM nf v LEFT JOIN nf_prod np ON v.codnf = np.codnf
       WHERE v.dtcontabil::date BETWEEN ${mesIni}::date AND ${mesFim}::date AND v.idempresa = ANY(${empresas}::int[]) AND np.codproduto = ${idproduto}
         AND v.tipo = 'E' AND v.proc = 'S'
       GROUP BY extract(month from v.dtcontabil), extract(year from v.dtcontabil)
       ORDER BY extract(year from v.dtcontabil) DESC, extract(month from v.dtcontabil) DESC`.execute(db)).rows.map((r) => ({ data: String(r.data), qtde: r2(num(r.qtde)) }));
    // sqqCompras: os pedidos de compra do período (as quantidades da loja)
    const compras = (await sql<Linha>`
      SELECT extract(month from v.data)::int || '/' || extract(year from v.data)::int AS data, sum(q.qtde) AS qtde
        FROM pedidocompra v
        LEFT JOIN pedidocompra_i np ON v.codpedcomp = np.codpedcomp
        LEFT JOIN pedido_compra_qtde q ON q.codpedcompi = np.codpedcompi AND q.qtde > 0
       WHERE v.data::date BETWEEN ${mesIni}::date AND ${mesFim}::date AND np.idproduto = ${idproduto} AND q.idempresa = ANY(${empresas}::int[])
       GROUP BY extract(month from v.data), extract(year from v.data)
       ORDER BY extract(year from v.data) DESC, extract(month from v.data) DESC`.execute(db)).rows.map((r) => ({ data: String(r.data), qtde: r2(num(r.qtde)) }));
    // sqqPedidoPendente: os pedidos de compra em aberto do produto
    const pendentes = (await sql<Linha>`
      SELECT a.codpedcomp AS nropedido, a.data AS dtpedido, q.qtde, a.codparceiro AS codfor, c.razao
        FROM pedidocompra a
        LEFT JOIN pedidocompra_i b ON b.codpedcomp = a.codpedcomp
        LEFT JOIN pedido_compra_qtde q ON q.codpedcompi = b.codpedcompi AND q.qtde > 0
        LEFT JOIN parceiros c ON c.codparceiro = a.codparceiro
       WHERE b.idproduto = ${idproduto} AND q.idempresa = ANY(${empresas}::int[]) AND coalesce(q.fechado, 'N') = 'N'
       ORDER BY a.data DESC`.execute(db)).rows.map((r) => ({ ...r, qtde: r2(num(r.qtde)) }));

    const numericos = (o: Linha, campos: string[]) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, campos.includes(k) ? r2(num(v)) : v]));
    return {
      empresas, origem, janela: { mesIni, mesFim, hoje: hojeStr },
      produto: numericos(produto, ['vrcusto', 'vrcustoreal', 'vrpromo', 'vrvenda', 'icmst', 'ipi', 'frete', 'despacessorio', 'markup', 'seguro', 'icm_efetivo', 'creditoicm',
        'creditopiscofins', 'debitoicm', 'debitopiscofins', 'vendaliq', 'lucrobrutov', 'despopv', 'lucroliqv', 'imprend', 'contsocial', 'margeml2v', 'margeml2']),
      lojas: lojas.map((l) => ({ idempresa: Number(l.idempresa), vrcusto: r2(num(l.vrcusto)), vrvenda: r2(num(l.vrvenda)) })),
      estoques: estoques.map((e) => ({ idempresa: Number(e.idempresa), qtde: r2(num(e.qtde)), qtde_dep: e.qtde_dep == null ? null : r2(num(e.qtde_dep)) })),
      mensal, total_mensal: r2(mensal.reduce((s, x) => s + x.qtde, 0)),
      entradas, total_entradas: r2(entradas.reduce((s, x) => s + x.qtde, 0)),
      semanas, dias, anual, compras, pendentes,
    };
  }
}
