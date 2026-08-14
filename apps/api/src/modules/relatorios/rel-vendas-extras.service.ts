import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroExtras {
  dtini: string; dtfim: string;
  horaIni?: string; horaFim?: string; filtrarHora?: boolean;
  canceladas?: 'N' | 'S' | 'T';
  produto?: string; fornecedor?: string;
  departamentos?: number[]; grupos?: number[]; subgrupos?: number[]; secoes?: number[];
}

/**
 * LOTE "EXTRAS" do hub FRMRELVENDAS — cinco variantes leves (nenhuma precisou de migration):
 *
 *  rel 21 `ProdutosVendidosPeriodoTicket` → produto × cupons: 2 níveis, o interno por (produto × NROCUPOM)
 *    com soma de UNITÁRIOS; CUPONS = COUNT(DISTINCT). PERC_MARGEM = participação do custo (NULLIF ⇒ branco).
 *    Unitários SUM(TOTAL)/SUM(QTDE) — NULLIF nosso documentado (o legado divide cru). Famílias por V.COD*.
 *  rel 22 `ProdutosVendidosPorEmpresa` → ⚠️ o NOME MENTE: tem `COALESCE(V.PROMOCAO,'N') = 'S'` fixo — é
 *    "produtos vendidos EM PROMOÇÃO por loja". Custo troca por VRCUSTOREP conforme a config (FFiltroCusto).
 *    Sem «Filtrar Hora» o legado pega dias inteiros.
 *  rel 26 `FinalizadorasPorDepto` → ⚠️ o NOME MENTE DUAS VEZES: "MODALIDADE" é `D.DESCRICAO`, o DEPARTAMENTO
 *    (via V.CODDPTO — o snapshot). Não há finalizadora nenhuma: é o gráfico de vendas por departamento. E o
 *    bruto usa o placeholder VALOR do legado = fórmula TRUNCADA SEM IAT (URelVendas.pas:1430).
 *  rel 33 `ProdutosPorFornecedor` → giro por fornecedor: Σqtde vendida × estoque atual (AVG(E.QTDE) sobre o
 *    join = o saldo). ⚠️ O legado NÃO filtra V.IDEMPRESA nesta variante (só o período) — soma as empresas da
 *    base inteira; preservado (o isolamento real é o schema do tenant). JOINs de MULTI_PRECO e UNIDADE
 *    existem no fonte e NÃO são usados no SELECT — não portados (no-ops 1:1).
 *  rel 39 `VendasDataHora` → dia × hora, mas ⚠️ a HORA vem de `SUBSTR(NROPEDIDO,9,2)` — embutida no número
 *    do PEDIDO (mesmo leiaute da CHAVE, lição 53), NÃO do timestamp; hora > 23 vira '00'. O bruto é o
 *    truncado-sem-IAT; LUCRO_B_PERCENT aqui é `((custo/venda)−1)×−100` = a rentabilidade CORRETA (ao
 *    contrário da fórmula quebrada da rel 02 — cada variante tem a sua); CUPONS = COUNT não-distinto dos
 *    grupos internos (item-level, o interno agrupa por CODVENDAS); VR_TICKET_MEDIO = AVG do total truncado
 *    por grupo interno.
 */
@Injectable()
export class RelVendasExtrasService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async ctx(f: FiltroExtras) {
    const emp = this.emp();
    if (!f.dtini || !f.dtfim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    if (String(f.dtini) > String(f.dtfim)) throw new BusinessRuleError('PERIODO_INVERTIDO', { dtini: f.dtini, dtfim: f.dtfim });
    const tz = String((await this.config.resolver('FUSO_HORARIO_ACESSO', { empresaId: emp })) ?? 'America/Sao_Paulo');
    const fimExcl = new Date(`${f.dtfim}T00:00:00Z`);
    if (Number.isNaN(fimExcl.getTime())) throw new BusinessRuleError('PERIODO_INVALIDO', { dtfim: f.dtfim });
    fimExcl.setUTCDate(fimExcl.getUTCDate() + 1);
    return { emp, tz, ate: fimExcl.toISOString().slice(0, 10), db: this.dbp.forTenantRead() as AnyDB };
  }

  private forms() {
    const bruto = sql`case when coalesce(v.iat,'') = 'A'
      then round((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric, 2)
      else trunc((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric * 100) / 100 end`;
    // o /*VALOR*/ do legado: SEMPRE truncado, ignora o IAT (URelVendas.pas:1430-1432)
    const brutoTrunc = sql`trunc((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric * 100) / 100`;
    const acresc = sql`greatest(coalesce(v.desc_acre_medio,0),0) + greatest(coalesce(v.desc_acre_item,0),0)`;
    const desc = sql`coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
      + abs(least(coalesce(v.desc_acre_medio,0),0)) + abs(least(coalesce(v.desc_acre_item,0),0))`;
    return { bruto, brutoTrunc, acresc, desc };
  }

  private aplicar<Q extends { where: (...a: any[]) => Q }>(
    q: Q, f: FiltroExtras, emp: number | null, tz: string, ate: string, opts: { diasInteiros?: boolean } = {},
  ): Q {
    let r = q;
    if (emp != null) r = r.where('v.idempresa', '=', emp);
    if (!opts.diasInteiros && f.filtrarHora && f.horaIni && f.horaFim) {
      r = r.where('v.dtvenda', '>=', sql`(${`${f.dtini} ${f.horaIni}`}::timestamp at time zone ${tz})`)
        .where('v.dtvenda', '<=', sql`(${`${f.dtfim} ${f.horaFim}`}::timestamp at time zone ${tz})`);
    } else {
      r = r.where('v.dtvenda', '>=', sql`(${f.dtini}::timestamp at time zone ${tz})`)
        .where('v.dtvenda', '<', sql`(${ate}::timestamp at time zone ${tz})`);
    }
    const canc = f.canceladas ?? 'N';
    if (canc === 'N') r = r.where(sql<boolean>`coalesce(v.cancelado,'N') = 'N'`);
    else if (canc === 'S') r = r.where(sql<boolean>`coalesce(v.cancelado,'N') = 'S'`);
    if (f.produto) r = r.where(sql<boolean>`upper(p.descricao) like ${`%${f.produto.toUpperCase()}%`}`);
    if (f.departamentos?.length) r = r.where('p.coddpto', 'in', f.departamentos.map(Number));
    if (f.grupos?.length) r = r.where('p.codgrupo', 'in', f.grupos.map(Number));
    if (f.subgrupos?.length) r = r.where('p.codsubgrupo', 'in', f.subgrupos.map(Number));
    if (f.secoes?.length) r = r.where('p.codsecao', 'in', f.secoes.map(Number));
    return r;
  }

  /** rel 21 — produtos vendidos × cupons (ticket por produto). */
  async ticketProduto(f: FiltroExtras) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { bruto, acresc, desc } = this.forms();
    const cupom = this.aplicar(
      db.selectFrom('vendas as v')
        .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
        .select([
          'p.idproduto', 'p.codbarra', sql`p.descricao`.as('descricao'), sql`v.unidade`.as('unidade'),
          'v.nrocupom',
          sql`sum(coalesce(v.vrcusto,0))`.as('vrcusto'),
          sql`sum(coalesce(v.vrvenda,0))`.as('vrvenda'),
          sql`sum(coalesce(v.qtde,0))`.as('qtde'),
          sql`round(sum(coalesce(v.qtde,0) * coalesce(v.vrcusto,0))::numeric, 2)`.as('total_custo'),
          sql`sum(${bruto})`.as('total_venda'),
          sql`sum(${acresc})`.as('acrescimo'),
          sql`sum(${desc})`.as('desc_promocao'),
        ]),
      f, emp, tz, ate,
    ).groupBy(['p.idproduto', 'p.codbarra', 'p.descricao', 'v.unidade', 'v.nrocupom']);
    const rows = (await db.selectFrom(cupom.as('c')).select([
      'c.idproduto', 'c.codbarra', 'c.descricao', 'c.unidade',
      sql`round(sum(c.qtde)::numeric, 3)`.as('qtde'),
      sql`round(sum(c.total_venda + c.acrescimo - c.desc_promocao)::numeric, 2)`.as('total_venda'),
      sql`round(sum(c.total_custo)::numeric, 2)`.as('total_custo'),
      sql`round(sum(c.vrcusto)::numeric, 2)`.as('soma_vrcusto_uni'),
      sql`round(sum(c.vrvenda)::numeric, 2)`.as('soma_vrvenda_uni'),
      // unitários SUM/SUM (NULLIF nosso; o legado divide cru) e PERC_MARGEM = participação do custo
      sql`round((sum(c.total_venda) / nullif(sum(c.qtde),0))::numeric, 2)`.as('vrvenda_uni'),
      sql`round((sum(c.total_custo) / nullif(sum(c.qtde),0))::numeric, 2)`.as('vrcusto_uni'),
      sql`round(sum((c.total_venda + c.acrescimo - c.desc_promocao) - c.total_custo)::numeric, 2)`.as('lucro_vr'),
      sql`round(((sum(c.total_custo) / nullif(sum(c.total_venda + c.acrescimo - c.desc_promocao),0)) * 100)::numeric, 2)`.as('perc_margem'),
      sql`count(distinct c.nrocupom)`.as('cupons'),
    ]).groupBy(['c.idproduto', 'c.codbarra', 'c.descricao', 'c.unidade'])
      .orderBy('c.descricao').limit(20001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 20000;
    const linhas = (truncado ? rows.slice(0, 20000) : rows).map((r) => ({
      ...r, qtde: num(r.qtde), total_venda: r2(num(r.total_venda)), total_custo: r2(num(r.total_custo)),
      cupons: Number(r.cupons ?? 0),
    }));
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        total_venda: r2(linhas.reduce((s, l) => s + num(l.total_venda), 0)),
        total_custo: r2(linhas.reduce((s, l) => s + num(l.total_custo), 0)),
      },
      filtro: { ...f, empresa: emp, fuso: tz, truncado, max_linhas: 20000 },
    };
  }

  /** rel 22 — produtos vendidos EM PROMOÇÃO (o nome do legado esconde o filtro fixo). */
  async promocaoPorLoja(f: FiltroExtras) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { bruto } = this.forms();
    const custoRep = String((await this.config.resolver('VENDAS_FILTRO_CUSTO', { empresaId: emp })) ?? 'C').toUpperCase() === 'R';
    const colCusto = custoRep ? sql`coalesce(v.vrcustorep,0)` : sql`coalesce(v.vrcusto,0)`;
    const rows = (await this.aplicar(
      db.selectFrom('vendas as v')
        .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
        .select([
          'v.idempresa', 'p.codbarra', sql`p.descricao`.as('descricao'), 'v.codproduto', sql`p.unidade`.as('unidade'),
          sql`round(sum(coalesce(v.qtde,0))::numeric, 3)`.as('qtde'),
          sql`round(sum(${bruto})::numeric, 2)`.as('vrvenda'),
          sql`round(sum(round((coalesce(v.qtde,0) * ${colCusto})::numeric, 2))::numeric, 2)`.as('vrcusto'),
        ])
        .where(sql<boolean>`coalesce(v.promocao,'N') = 'S'`),
      f, emp, tz, ate, { diasInteiros: !f.filtrarHora },
    ).groupBy(['v.idempresa', 'v.codproduto', 'p.codbarra', 'p.descricao', 'p.unidade'])
      .orderBy(sql`p.descricao`).orderBy('v.codproduto').limit(20001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 20000;
    const linhas = (truncado ? rows.slice(0, 20000) : rows).map((r) => ({
      ...r, qtde: num(r.qtde), vrvenda: r2(num(r.vrvenda)), vrcusto: r2(num(r.vrcusto)),
    }));
    return {
      linhas,
      totais: { linhas: linhas.length, vrvenda: r2(linhas.reduce((s, l) => s + num(l.vrvenda), 0)) },
      filtro: { ...f, empresa: emp, fuso: tz, custo: custoRep ? 'REPOSICAO' : 'CUSTO', truncado, max_linhas: 20000 },
    };
  }

  /** rel 26 — vendas por DEPARTAMENTO (a "MODALIDADE" do legado é o departamento; bruto truncado sem IAT). */
  async porDepartamento(f: FiltroExtras) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { brutoTrunc, acresc, desc } = this.forms();
    const interno = this.aplicar(
      db.selectFrom('vendas as v')
        .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
        .leftJoin('familias_prod as d', 'd.codfamilia', 'v.coddpto')
        .select([
          sql`d.descricao`.as('modalidade'),
          sql`sum(${brutoTrunc}) + sum(${acresc}) - sum(${desc})`.as('total_venda'),
        ]),
      f, emp, tz, ate,
    ).groupBy([sql`d.descricao`, 'v.nrocupom', 'v.codvendas']);
    const rows = (await db.selectFrom(interno.as('i'))
      .select(['i.modalidade', sql`round(sum(i.total_venda)::numeric, 2)`.as('total_venda')])
      .groupBy('i.modalidade').orderBy('i.modalidade').execute()) as Record<string, unknown>[];
    const linhas = rows.map((r) => ({ modalidade: r.modalidade, total_venda: r2(num(r.total_venda)) }));
    const total = r2(linhas.reduce((s, l) => s + num(l.total_venda), 0));
    return {
      linhas: linhas.map((l) => ({ ...l, participacao: total !== 0 ? r2((num(l.total_venda) * 100) / total) : null })),
      totais: { total_venda: total, departamentos: linhas.length },
      filtro: { ...f, empresa: emp, fuso: tz },
    };
  }

  /** rel 33 — giro por fornecedor (Σ vendida × estoque atual). ⚠️ o legado NÃO filtra a empresa nas VENDAS. */
  async porFornecedor(f: FiltroExtras) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const rows = (await this.aplicar(
      db.selectFrom('vendas as v')
        .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
        .leftJoin('estoque as e', (j) => j.on(sql<boolean>`e.idproduto = v.codproduto and e.idempresa = ${emp}`))
        .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
        .select([
          'p.codbarra', sql`p.descricao`.as('descricao'),
          sql`round(avg(coalesce(e.qtde,0))::numeric, 3)`.as('qtde_estoque'),
          sql`forn.razao`.as('razao'),
          sql`round(sum(coalesce(v.qtde,0))::numeric, 3)`.as('qtde_vnd'),
        ]),
      // emp = null: fiel — a query do legado não tem "AND V.IDEMPRESA IN (...)" (o isolamento é o schema)
      f, null, tz, ate,
    ).groupBy(['p.codbarra', 'p.descricao', sql`forn.razao`])
      .orderBy(sql`forn.razao`).orderBy(sql`sum(coalesce(v.qtde,0)) desc`).limit(20001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 20000;
    const linhas: Record<string, unknown>[] = (truncado ? rows.slice(0, 20000) : rows).map((r) => ({
      ...r, qtde_estoque: num(r.qtde_estoque), qtde_vnd: num(r.qtde_vnd),
    }));
    return {
      linhas,
      totais: { linhas: linhas.length, fornecedores: new Set(linhas.map((l) => l.razao)).size },
      filtro: { ...f, fuso: tz, truncado, max_linhas: 20000 },
    };
  }

  /** rel 39 — dia × hora, com a HORA vinda do NROPEDIDO (posições 9-10). */
  async dataHora(f: FiltroExtras) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { brutoTrunc, acresc, desc } = this.forms();
    const interno = this.aplicar(
      db.selectFrom('vendas as v')
        .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
        .select([
          sql`to_char(v.dtvenda at time zone ${tz}, 'YYYY-MM-DD')`.as('dia'),
          // a HORA embutida no nº do pedido — leiaute PP AAMMDD HHMMSS (lição 53); > 23 vira '00'
          sql`case when coalesce(nullif(substring(coalesce(v.nropedido,'') from 9 for 2), ''), '00') ~ '^[0-9]+$'
                and substring(v.nropedido from 9 for 2)::int > 23 then '00'
              else coalesce(nullif(substring(coalesce(v.nropedido,'') from 9 for 2), ''), '00') end`.as('hora'),
          sql`sum(${brutoTrunc}) + sum(${acresc}) - sum(${desc})`.as('total_venda'),
          sql`round(sum(coalesce(v.qtde,0) * coalesce(v.vrcusto,0))::numeric, 2)`.as('total_custo'),
          sql`sum(${brutoTrunc})`.as('calcvlrmedio'),
          'v.nrocupom',
        ]),
      f, emp, tz, ate,
    ).groupBy([sql`1`, sql`2`, 'v.nrocupom', 'v.codvendas']);
    const rows = (await db.selectFrom(interno.as('i')).select([
      'i.dia', 'i.hora',
      sql`round(sum(i.total_venda)::numeric, 2)`.as('total_venda'),
      sql`round(sum(i.total_custo)::numeric, 2)`.as('total_custo'),
      sql`round(avg(i.calcvlrmedio)::numeric, 2)`.as('vr_ticket_medio'),
      sql`round((sum(i.total_venda) - sum(i.total_custo))::numeric, 2)`.as('total_lucro'),
      // aqui a fórmula do legado É a rentabilidade correta: ((custo/venda)−1)×−100 — ≠ da rel 02 (quebrada)
      sql`case when sum(i.total_venda) <> 0
        then round((((sum(i.total_custo) / sum(i.total_venda)) - 1) * -100)::numeric, 2) end`.as('lucro_b_percent'),
      sql`case when sum(i.total_venda) = 0 then 0
        else round((((sum(i.total_venda) - sum(i.total_custo)) / sum(i.total_venda)) * 100)::numeric, 2) end`.as('rentabilidade'),
      sql`case when sum(i.total_custo) = 0 then 0
        else round((((sum(i.total_venda) / sum(i.total_custo)) - 1) * 100)::numeric, 2) end`.as('margem'),
      // COUNT NÃO-distinto dos grupos internos (item-level, o interno tem CODVENDAS) — fiel
      sql`count(i.nrocupom)`.as('cupons'),
    ]).groupBy(['i.dia', 'i.hora']).orderBy('i.dia').orderBy('i.hora').execute()) as Record<string, unknown>[];
    const linhas: Record<string, unknown>[] = rows.map((r) => ({
      ...r, total_venda: r2(num(r.total_venda)), total_custo: r2(num(r.total_custo)),
      cupons: Number(r.cupons ?? 0),
    }));
    return {
      linhas,
      totais: {
        total_venda: r2(linhas.reduce((s, l) => s + num(l.total_venda), 0)),
        dias: new Set(linhas.map((l) => l.dia)).size,
      },
      filtro: { ...f, empresa: emp, fuso: tz },
    };
  }

  /** rel 29 — vendas por CLIENTE e VENDEDOR: 1 linha por PEDIDO, com a forma de pagamento do caixa. */
  async clienteVendedor(f: FiltroExtras) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { bruto, acresc, desc } = this.forms();
    // OPERACAO = MIN(operacao) dos pagamentos 'C' do pedido em CX_VENDAS (a "forma" que o legado exibe)
    const cx = db.selectFrom('cx_vendas')
      .select(['nropedido', sql`min(operacao)`.as('operacao')])
      .where(sql<boolean>`debito_credito = 'C'`)
      .groupBy('nropedido');
    const rows = (await this.aplicar(
      db.selectFrom('vendas as v')
        .leftJoin('parceiros as c', 'c.codparceiro', 'v.codparceiro')
        .leftJoin('parceiros as ve', 've.codparceiro', 'v.codvendedor')
        .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
        .leftJoin(cx.as('cx'), 'cx.nropedido', 'v.nropedido')
        .select([
          sql`cx.operacao`.as('operacao'),
          'v.nropedido',
          sql`coalesce(ve.razao, 'SEM VENDEDOR')`.as('vendedor'),
          sql`v.razao`.as('razao'),
          sql`to_char(v.dtvenda at time zone ${tz}, 'YYYY-MM-DD')`.as('data'),
          // PDV = os 2 primeiros chars do nº do pedido (o leiaute PP AAMMDD HHMMSS de novo)
          sql`substring(coalesce(v.nropedido,'') from 1 for 2)`.as('pdv'),
          sql`coalesce(v.codvendedor, 0)`.as('codvendedor'),
          sql`min(v.nrocupom)`.as('nrocupom'),
          sql`min(to_char(v.dtvenda at time zone ${tz}, 'HH24:MI:SS'))`.as('hora'),
          // TOTAL_VENDA da rel 29 = bruto + acréscimo − DESCONTO (o legado chama o desconto de DESC_ACRE)
          sql`round((sum(${bruto}) + sum(${acresc}) - sum(${desc}))::numeric, 2)`.as('total_venda'),
          sql`round(sum(${acresc})::numeric, 2)`.as('acrescimo'),
          sql`round(sum(${desc})::numeric, 2)`.as('desc_acre'),
        ]),
      f, emp, tz, ate,
    ).groupBy([sql`cx.operacao`, 'v.nropedido', sql`3`, sql`v.razao`, sql`5`, sql`6`, sql`7`])
      .orderBy(sql`7`).orderBy(sql`5`).limit(20001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 20000;
    const linhas: Record<string, unknown>[] = (truncado ? rows.slice(0, 20000) : rows).map((r) => ({
      ...r, total_venda: r2(num(r.total_venda)), acrescimo: r2(num(r.acrescimo)), desc_acre: r2(num(r.desc_acre)),
    }));
    return {
      linhas,
      totais: {
        pedidos: linhas.length,
        total_venda: r2(linhas.reduce((s2, l) => s2 + num(l.total_venda), 0)),
        vendedores: new Set(linhas.map((l) => l.vendedor)).size,
      },
      filtro: { ...f, empresa: emp, fuso: tz, truncado, max_linhas: 20000 },
    };
  }

  /** rel 31 — Curva ABC 2: a curva da rel 09 + o preço/custo ATUAL do multi_preco ao lado. */
  async abc2(f: FiltroExtras) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { bruto, acresc, desc } = this.forms();
    const rows = (await this.aplicar(
      db.selectFrom('vendas as v')
        .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
        .leftJoin('empresas as e', 'e.idempresa', 'v.idempresa')
        .leftJoin('multi_preco as m', (j) => j.on(sql<boolean>`m.idproduto = v.codproduto and m.idempresa = v.idempresa`))
        .select([
          'p.idproduto', 'p.codbarra', sql`p.descricao`.as('descricao'),
          sql`v.unidade`.as('unidade'), 'v.aliquota',
          sql`e.pc_curva_abc_a`.as('pc_a'), sql`e.pc_curva_abc_b`.as('pc_b'), sql`e.pc_curva_abc_c`.as('pc_c'),
          sql`round(sum(coalesce(v.qtde,0))::numeric, 2)`.as('qtde'),
          sql`round((sum(${bruto}) + sum(${acresc}) - sum(${desc}))::numeric, 2)`.as('total_venda'),
          sql`round(sum(coalesce(v.qtde,0) * coalesce(v.vrcusto,0))::numeric, 2)`.as('total_custo'),
          // o preço/custo DE HOJE (multi_preco) e a MARGEM atual = participação do custo no preço (CASE→0)
          sql`max(m.vrvenda)`.as('vrvenda_atual'),
          sql`max(m.vrcusto)`.as('vrcusto_atual'),
          sql`case when max(m.vrvenda) > 0
            then round(((coalesce(max(m.vrcusto),0) / max(m.vrvenda)) * 100)::numeric, 2) else 0 end`.as('margem_atual'),
        ]),
      f, emp, tz, ate,
    ).groupBy(['p.idproduto', 'p.codbarra', 'p.descricao', 'v.unidade', 'v.aliquota', sql`e.pc_curva_abc_a`, sql`e.pc_curva_abc_b`, sql`e.pc_curva_abc_c`])
      .orderBy(sql`(sum(${bruto}) + sum(${acresc}) - sum(${desc})) desc`).orderBy('p.idproduto')
      .limit(20001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 20000;
    const base = truncado ? rows.slice(0, 20000) : rows;
    // a classificação do .fr3 (a mesma da rel 09: 1ª linha A, cortes cumulativos, faixa sem letra herda)
    const totalGeral = r2(base.reduce((s2, r) => s2 + num(r.total_venda), 0));
    let acumulado = 0; let anterior: string | null = null;
    const linhas: Record<string, unknown>[] = base.map((r, i) => {
      const pA = num(r.pc_a), pB = num(r.pc_a) + num(r.pc_b), pC = num(r.pc_a) + num(r.pc_b) + num(r.pc_c);
      const perc = totalGeral !== 0 ? (num(r.total_venda) * 100) / totalGeral : null;
      acumulado += perc ?? 0;
      let abc: string | null; let herdado = false;
      if (i === 0) abc = 'A';
      else if (acumulado <= pA) abc = 'A';
      else if (acumulado > pA && acumulado <= pB) abc = 'B';
      else if ((acumulado > pB && acumulado <= pC) || acumulado > 100) abc = 'C';
      else { abc = anterior; herdado = true; }
      anterior = abc;
      return { ...r, total_venda: r2(num(r.total_venda)), total_custo: r2(num(r.total_custo)),
        perc: perc == null ? null : r2(perc), perc_acumulado: perc == null ? null : r2(acumulado), abc, abc_herdado: herdado };
    });
    return {
      linhas,
      totais: { linhas: linhas.length, total_venda: totalGeral },
      filtro: { ...f, empresa: emp, fuso: tz, truncado, max_linhas: 20000 },
    };
  }

  /** rel 34 — a GRADE gerencial por produto: giro, saldo, valor de estoque, margem. */
  async grid(f: FiltroExtras) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { brutoTrunc, acresc, desc } = this.forms();
    // FDias do legado = DaysBetween(fim, ini) com mínimo 1 (URelVendas.pas:1360-1362) — NÃO soma 1
    const dias = Math.max(1, Math.round((new Date(`${f.dtfim}T00:00:00Z`).getTime() - new Date(`${f.dtini}T00:00:00Z`).getTime()) / 86400000));
    const rows = (await this.aplicar(
      db.selectFrom('vendas as v')
        .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
        .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
        .leftJoin('familias_prod as d', 'd.codfamilia', 'p.coddpto')
        .leftJoin('multi_preco as m', (j) => j.on(sql<boolean>`m.idproduto = v.codproduto and m.idempresa = v.idempresa`))
        .leftJoin('estoque as e', (j) => j.on(sql<boolean>`e.idproduto = v.codproduto and e.idempresa = ${emp}`))
        .select([
          'p.idproduto', 'p.codbarra', sql`p.descricao`.as('descricao'), sql`v.unidade`.as('unidade'),
          'p.codfor', sql`forn.razao`.as('nomefor'), 'p.coddpto', sql`d.descricao`.as('nomedpto'),
          sql`m.ativo`.as('ativo'), sql`m.ativo_compra`.as('ativo_compra'),
          sql`round(avg(coalesce(v.vrcusto,0))::numeric, 4)`.as('t_total_custo'),
          sql`round(avg(coalesce(v.vrvenda,0))::numeric, 2)`.as('vrvenda_medio'),
          sql`round(sum(coalesce(v.qtde,0))::numeric, 3)`.as('qtde'),
          sql`round(sum(coalesce(v.qtde,0) * coalesce(v.vrcusto,0))::numeric, 2)`.as('total_custo'),
          // ⚠️ o TOTAL_VENDA da grade é o BRUTO TRUNCADO (sem IAT, sem descontos); o ajuste sai em DESC_ACRE
          sql`round(sum(${brutoTrunc})::numeric, 2)`.as('total_venda'),
          sql`round((sum(${acresc}) - sum(${desc}))::numeric, 2)`.as('desc_acre'),
          sql`round(avg(coalesce(e.qtde,0))::numeric, 3)`.as('saldo'),
          // ⚠️ TICKET_MEDIO da grade = COUNT(NROCUPOM) — é uma CONTAGEM DE ITENS, o nome mente
          sql`count(v.nrocupom)`.as('ticket_medio'),
        ]),
      f, emp, tz, ate, { diasInteiros: !f.filtrarHora },
    ).groupBy(['p.idproduto', 'p.codbarra', 'p.descricao', 'v.unidade', 'p.codfor', sql`forn.razao`, 'p.coddpto', sql`d.descricao`, sql`m.ativo`, sql`m.ativo_compra`])
      .orderBy(sql`sum(${brutoTrunc}) desc`).limit(20001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 20000;
    const linhas: Record<string, unknown>[] = (truncado ? rows.slice(0, 20000) : rows).map((r) => {
      const qt = num(r.qtde);
      const venda = r2(num(r.total_venda));
      const custo = r2(num(r.total_custo));
      const ajuste = r2(num(r.desc_acre));
      const saldo = num(r.saldo);
      const giros = r2(qt / dias);
      const custoUni = qt !== 0 ? custo / qt : num(r.t_total_custo);
      return {
        ...r,
        total_venda: venda, total_custo: custo, desc_acre: ajuste, saldo,
        vrvenda_uni: qt !== 0 ? r2(venda / qt) : null,
        total_custo_uni: qt !== 0 ? r2(custo / qt) : null,
        // participação do custo na venda AJUSTADA (a MARGEM_BRUTA do legado; 0 quando venda 0)
        margem_bruta: venda + ajuste !== 0 ? r2((custo / (venda + ajuste)) * 100) : 0,
        giros,
        valor_estoque: r2(saldo * custoUni),
        // a fórmula do legado: GIROS ÷ QTDE — copiada como está (o nome promete "dias de estoque")
        dias_de_estoque: qt !== 0 ? r2(giros / qt) : 0,
        ticket_medio: Number(r.ticket_medio ?? 0),
      };
    });
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        total_venda: r2(linhas.reduce((s2, l) => s2 + num(l.total_venda), 0)),
        valor_estoque: r2(linhas.reduce((s2, l) => s2 + num(l.valor_estoque), 0)),
        dias_periodo: dias,
      },
      filtro: { ...f, empresa: emp, fuso: tz, truncado, max_linhas: 20000 },
    };
  }

  /**
   * rel 15/16 — PIS/COFINS dos produtos vendidos. As duas variantes compartilham as medidas; mudam a CHAVE e
   * o JOIN com PISCOFINS:
   *  · rel 15 (por produto): `JOIN PISCOFINS ON PC.IDPISCOFINS = P.IDPISCOFINS` — a situação do CADASTRO.
   *    Tem um `LEFT JOIN MULTI_PRECO ... M.IDEMPRESA = 1` FIXO no fonte, e M não é usado no SELECT — no-op
   *    do vício IDEMPRESA=1 (4ª ocorrência); não portado.
   *  · rel 16 (por TIPO): `PC.IDPISCOFINS = COALESCE(V.IDPISCOFINS, P.IDPISCOFINS)` — a situação DA VENDA
   *    tem precedência sobre a do cadastro, e o JOIN é INNER (venda sem situação NENHUMA sai do relatório).
   * Medidas: PISCOFINS_E/S = MAX(alíquota × unitário) — o MAIOR imposto unitário do grupo, não média;
   * TOTAL_PISCOFINS_E = Σ qtde×custo×(pis_ent+cofins_ent)/100; _S idem com venda/saída; SALDO = S − E
   * (o quanto a venda gera de débito além do crédito da entrada). PERC_MARGEM = participação do custo.
   */
  async piscofins(f: FiltroExtras, porTipo: boolean) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { bruto, acresc, desc } = this.forms();
    const aliqE = sql`(coalesce(pc.aliq_pis_ent,0) + coalesce(pc.aliq_cofins_ent,0))`;
    const aliqS = sql`(coalesce(pc.aliq_pis_sai,0) + coalesce(pc.aliq_cofins_sai,0))`;
    let q = db.selectFrom('vendas as v')
      .$if(porTipo, (qb) => qb.innerJoin('produtos as p', 'p.idproduto', 'v.codproduto'))
      .$if(!porTipo, (qb) => qb.leftJoin('produtos as p', 'p.idproduto', 'v.codproduto'))
      .innerJoin('piscofins as pc', (j) => porTipo
        ? j.on(sql<boolean>`pc.idpiscofins = coalesce(v.idpiscofins, p.idpiscofins)`)
        : j.on(sql<boolean>`pc.idpiscofins = p.idpiscofins`))
      .select([
        ...(porTipo
          ? [sql`pc.descricao`.as('chave')]
          : [sql`p.descricao`.as('chave'), 'p.idproduto', 'p.codbarra', sql`v.unidade`.as('unidade')]),
        sql`round(sum(coalesce(v.vrcusto,0))::numeric, 2)`.as('soma_vrcusto_uni'),
        sql`round(sum(coalesce(v.vrvenda,0))::numeric, 2)`.as('soma_vrvenda_uni'),
        sql`round(sum(coalesce(v.qtde,0))::numeric, 3)`.as('qtde'),
        sql`round(sum(round((coalesce(v.qtde,0) * coalesce(v.vrcusto,0))::numeric, 2))::numeric, 2)`.as('total_custo'),
        sql`round((sum(${bruto}) + sum(${acresc}) - sum(${desc}))::numeric, 2)`.as('total_venda'),
        sql`round(max(round((${aliqE} * coalesce(v.vrcusto,0) / 100)::numeric, 2))::numeric, 2)`.as('piscofins_e'),
        sql`round(max(round((${aliqS} * coalesce(v.vrvenda,0) / 100)::numeric, 2))::numeric, 2)`.as('piscofins_s'),
        sql`round(sum(round((coalesce(v.qtde,0) * coalesce(v.vrcusto,0) * ${aliqE} / 100)::numeric, 2))::numeric, 2)`.as('total_piscofins_e'),
        sql`round(sum(round((coalesce(v.qtde,0) * coalesce(v.vrvenda,0) * ${aliqS} / 100)::numeric, 2))::numeric, 2)`.as('total_piscofins_s'),
        sql`round(sum(round(((coalesce(v.qtde,0) * coalesce(v.vrvenda,0) * ${aliqS} / 100)
          - (coalesce(v.qtde,0) * coalesce(v.vrcusto,0) * ${aliqE} / 100))::numeric, 2))::numeric, 2)`.as('saldo_piscofins'),
      ]);
    q = this.aplicar(q, f, emp, tz, ate);
    q = porTipo
      ? q.groupBy([sql`pc.descricao`])
      : q.groupBy([sql`p.descricao`, 'p.idproduto', 'p.codbarra', sql`v.unidade`]);
    const rows = (await q.orderBy(sql`1`).limit(20001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 20000;
    const linhas: Record<string, unknown>[] = (truncado ? rows.slice(0, 20000) : rows).map((r) => {
      const venda = r2(num(r.total_venda)); const custo = r2(num(r.total_custo));
      return { ...r, total_venda: venda, total_custo: custo,
        lucro_vr: r2(venda - custo),
        perc_margem: venda !== 0 ? r2((custo / venda) * 100) : null };
    });
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        total_venda: r2(linhas.reduce((s2, l) => s2 + num(l.total_venda), 0)),
        total_piscofins_s: r2(linhas.reduce((s2, l) => s2 + num(l.total_piscofins_s), 0)),
        total_piscofins_e: r2(linhas.reduce((s2, l) => s2 + num(l.total_piscofins_e), 0)),
        saldo_piscofins: r2(linhas.reduce((s2, l) => s2 + num(l.saldo_piscofins), 0)),
      },
      filtro: { ...f, empresa: emp, fuso: tz, truncado, max_linhas: 20000 },
    };
  }

  /**
   * rel 03 `VendasClienteCompra` — o que cada CLIENTE comprou: 1 linha por produto × pedido × cliente.
   * O interno agrupa por CODVENDAS (a PK) ⇒ colapsa (prova da rel 01). Peculiaridades:
   *  · a coluna `DESC_ACRE` desta variante é DESC_PROMOCAO **+** ACRESCIMO (a soma dos dois ajustes, não o
   *    desconto — o SUM(DESC_ACRE) verdadeiro está COMENTADO no fonte);
   *  · o nome do vendedor vem de OPERADORES via um derived (MAX(CODOPERADOR) por parceiro, DESABILITADO='N')
   *    casado com V.CODVENDEDOR — colapsado aqui no join direto equivalente;
   *  · `V.COMISSAO` está no SELECT/GROUP do legado e é **0 em toda a história do tenant** (mig 141) — sai
   *    como literal 0;
   *  · «Exibir produtos filhos» suportado (o mesmo COALESCE das rel 01/46).
   */
  async clienteCompra(f: FiltroExtras & { exibirFilhos?: boolean }) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { bruto, acresc, desc } = this.forms();
    const chaveProduto = f.exibirFilhos ? sql`coalesce(v.idproduto_filho, v.codproduto)` : sql`v.codproduto`;
    const rows = (await this.aplicar(
      db.selectFrom('vendas as v')
        .leftJoin('produtos as p', (j) => j.on(sql<boolean>`p.idproduto = ${chaveProduto}`))
        .leftJoin('familias_prod as d', 'd.codfamilia', 'p.coddpto')
        .leftJoin('parceiros as c', 'c.codparceiro', 'v.codparceiro')
        .leftJoin('operadores as op', (j) => j.on(sql<boolean>`op.codoperador = v.codvendedor and coalesce(op.desabilitado,'N') = 'N'`))
        .select([
          'p.idproduto', 'p.codbarra', sql`p.descricao`.as('descricao'), sql`p.unidade`.as('unidade'),
          sql`d.descricao`.as('depto'),
          'v.nropedido', 'v.nrocupom', sql`v.razao`.as('razao'), 'v.promocao', 'v.aliquota',
          sql`to_char(v.dtvenda at time zone ${tz}, 'YYYY-MM-DD')`.as('data'),
          sql`op.nome`.as('vendedor'),
          sql`round(sum(coalesce(v.qtde,0))::numeric, 3)`.as('qtde'),
          sql`round((sum(${bruto}) + sum(${acresc}) - sum(${desc}))::numeric, 2)`.as('total_venda'),
          sql`round(sum(round((coalesce(v.qtde,0) * coalesce(v.vrcusto,0))::numeric, 2))::numeric, 2)`.as('total_custo'),
          // a "DESC_ACRE" da rel 03 = desconto + acréscimo SOMADOS (o verdadeiro está comentado no fonte)
          sql`round((sum(${desc}) + sum(${acresc}))::numeric, 2)`.as('desc_acre'),
          sql`round(sum(${acresc})::numeric, 2)`.as('acrescimo'),
          sql`round(sum(${desc})::numeric, 2)`.as('desc_promocao'),
        ]),
      f, emp, tz, ate,
    ).groupBy(['p.idproduto', 'p.codbarra', 'p.descricao', 'p.unidade', sql`d.descricao`,
      'v.nropedido', 'v.nrocupom', sql`v.razao`, 'v.promocao', 'v.aliquota', sql`11`, sql`op.nome`])
      .orderBy(sql`v.razao`).orderBy(sql`11`).orderBy('v.nropedido').orderBy(sql`p.descricao`)
      .limit(20001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 20000;
    const linhas: Record<string, unknown>[] = (truncado ? rows.slice(0, 20000) : rows).map((r) => {
      const venda = r2(num(r.total_venda)); const custo = r2(num(r.total_custo));
      return { ...r, total_venda: venda, total_custo: custo, qtde: num(r.qtde),
        lucro: r2(venda - custo),
        rentabilidade: venda !== 0 ? r2(((venda - custo) / venda) * 100) : null,
        margem: venda !== 0 ? r2((custo / venda) * 100) : null,
        comissao: 0 };
    });
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        clientes: new Set(linhas.map((l) => l.razao)).size,
        total_venda: r2(linhas.reduce((s2, l) => s2 + num(l.total_venda), 0)),
      },
      filtro: { ...f, empresa: emp, fuso: tz, truncado, max_linhas: 20000 },
    };
  }

  /**
   * rel 40 `VendasICMS` — venda por produto × alíquota com o ICMS calculado. O percentual vem de
   * DET_ALIQUOTA pela **UF DA EMPRESA** (`DA.ALIQUOTA = A.ALIQUOTA AND DA.UF = E.UF`); as alíquotas
   * 'STB','IST','NTB' são ZERADAS pelo CASE (substituição/isenção não geram débito na venda).
   * VALOR_ICMS = venda líquida × percentual/100. O interno agrupa por pedido+item ⇒ colapsa.
   */
  async icms(f: FiltroExtras) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { bruto, acresc, desc } = this.forms();
    const valorAliquota = sql`case when v.aliquota in ('STB','IST','NTB') then 0 else coalesce(da.icm_efetivo,0) end`;
    const rows = (await this.aplicar(
      db.selectFrom('vendas as v')
        .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
        .leftJoin('empresas as e', 'e.idempresa', 'v.idempresa')
        .leftJoin('det_aliquota as da', (j) => j.on(sql<boolean>`da.aliquota = v.aliquota and da.uf = e.uf`))
        .select([
          'p.idproduto', 'p.codbarra', sql`p.descricao`.as('descricao'),
          'v.aliquota',
          sql`${valorAliquota}`.as('valor_aliquota'),
          sql`round(sum(coalesce(v.qtde,0))::numeric, 3)`.as('qtde'),
          sql`round((sum(${bruto}) + sum(${acresc}) - sum(${desc}))::numeric, 2)`.as('total_venda'),
          sql`round(((sum(${bruto}) + sum(${acresc}) - sum(${desc})) * ${valorAliquota} / 100)::numeric, 2)`.as('valor_icms'),
        ]),
      f, emp, tz, ate,
    ).groupBy(['p.idproduto', 'p.codbarra', 'p.descricao', 'v.aliquota', sql`5`])
      .orderBy('v.aliquota').orderBy(sql`p.descricao`).limit(20001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 20000;
    const linhas: Record<string, unknown>[] = (truncado ? rows.slice(0, 20000) : rows).map((r) => ({
      ...r, qtde: num(r.qtde), total_venda: r2(num(r.total_venda)), valor_icms: r2(num(r.valor_icms)),
    }));
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        total_venda: r2(linhas.reduce((s2, l) => s2 + num(l.total_venda), 0)),
        valor_icms: r2(linhas.reduce((s2, l) => s2 + num(l.valor_icms), 0)),
      },
      filtro: { ...f, empresa: emp, fuso: tz, truncado, max_linhas: 20000 },
    };
  }

  /**
   * rel 37 `VendasDataCadastroProduto` — vendas de PRODUTOS NOVOS: só entram produtos cujo DTCADASTRO cai
   * NO MESMO período do relatório (o `filtroM` do legado é a própria faixa dtini+hora→dtfim+hora; a função
   * tem uma geração antiga morta antes do `Result :=` vivo — lição 30). Peculiaridades da geração viva:
   *  · TOTAL_CUSTO é COMPOSTO com os encargos do multi_preco: custo + qtde×ICMST + custo×FRETE% +
   *    custo×DESPACESSORIO%/100 + custo×IPI%/100 — ⚠️ o SQL divide DESPACESSORIO por 100 como se fosse %,
   *    mas a precificação (mig 129) o trata como VALOR: divergência interna do legado, copiada como a
   *    variante faz;
   *  · o bruto é o placeholder VALOR (truncado SEM IAT);
   *  · PERC_MARGEM divide pelo BRUTO (não o ajustado) e SEM NULLIF no fonte (protegido aqui ⇒ null);
   *  · RENTABILIDADE divide pelo BRUTO com NULLIF; MARGEM = custo/ajustado com NULLIF;
   *  · agrupa por produto × empresa (com FANTASIA) e famílias por V.COD* (snapshot).
   */
  async dataCadastro(f: FiltroExtras) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { brutoTrunc, acresc, desc } = this.forms();
    const custoComposto = sql`sum(round((coalesce(v.qtde,0) * coalesce(v.vrcusto,0))::numeric, 2))
      + sum(coalesce(v.qtde,0) * coalesce(m.icmst,0))
      + (sum(coalesce(v.qtde,0) * coalesce(v.vrcusto,0) * coalesce(m.frete,0)) / 100)
      + round((sum(coalesce(v.qtde,0) * coalesce(v.vrcusto,0) * coalesce(m.despacessorio,0)) / 100)::numeric, 2)
      + round((sum(coalesce(v.qtde,0) * coalesce(v.vrcusto,0) * coalesce(m.ipi,0)) / 100)::numeric, 2)`;
    let q = db.selectFrom('vendas as v')
      .innerJoin('empresas as e', 'e.idempresa', 'v.idempresa')
      .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
      .leftJoin('familias_prod as d', 'd.codfamilia', 'v.coddpto')
      .leftJoin('familias_prod as g', 'g.codfamilia', 'v.codgrupo')
      .leftJoin('familias_prod as sg', 'sg.codfamilia', 'v.codsubgrupo')
      .leftJoin('multi_preco as m', (j) => j.on(sql<boolean>`m.idproduto = v.codproduto and m.idempresa = v.idempresa`))
      .select([
        'p.idproduto', 'p.codbarra', sql`p.descricao`.as('descricao'), sql`v.unidade`.as('unidade'),
        sql`e.fantasia`.as('fantasia'),
        sql`d.descricao`.as('depto'), sql`g.descricao`.as('grupo'), sql`sg.descricao`.as('subgrupo'),
        sql`round(sum(coalesce(v.qtde,0))::numeric, 3)`.as('qtde'),
        sql`round(sum(${brutoTrunc})::numeric, 2)`.as('bruto'),
        sql`round((${custoComposto})::numeric, 2)`.as('total_custo'),
        sql`round(sum(${acresc})::numeric, 2)`.as('acrescimo'),
        sql`round(sum(${desc})::numeric, 2)`.as('desc_promocao'),
        sql`round(sum(coalesce(v.desc_acre,0))::numeric, 2)`.as('desc_acre'),
      ])
      // o EXISTS do legado: produto CADASTRADO dentro do período do relatório
      .where(sql<boolean>`exists (select 1 from produtos px where px.idproduto = v.codproduto
        and px.dtcadastro >= (${f.dtini}::timestamp at time zone ${tz})
        and px.dtcadastro < (${ate}::timestamp at time zone ${tz}))`);
    q = this.aplicar(q, f, emp, tz, ate);
    const rows = (await q.groupBy(['p.idproduto', 'p.codbarra', 'p.descricao', sql`v.unidade`, sql`e.fantasia`,
      sql`d.descricao`, sql`g.descricao`, sql`sg.descricao`])
      .orderBy(sql`e.fantasia`).orderBy(sql`p.descricao`).limit(20001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 20000;
    const linhas: Record<string, unknown>[] = (truncado ? rows.slice(0, 20000) : rows).map((r) => {
      const brutoV = r2(num(r.bruto)); const custo = r2(num(r.total_custo));
      const ajustado = r2(brutoV + num(r.acrescimo) - num(r.desc_promocao));
      return { ...r, qtde: num(r.qtde), total_venda: ajustado, total_custo: custo,
        lucro: r2(ajustado - custo),
        perc_margem: brutoV !== 0 ? r2(((brutoV - custo) / brutoV) * 100) : null,
        rentabilidade: brutoV !== 0 ? r2(((ajustado - custo) / brutoV) * 100) : null,
        margem: ajustado !== 0 ? r2((custo / ajustado) * 100) : null };
    });
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        total_venda: r2(linhas.reduce((s2, l) => s2 + num(l.total_venda), 0)),
        total_custo: r2(linhas.reduce((s2, l) => s2 + num(l.total_custo), 0)),
      },
      filtro: { ...f, empresa: emp, fuso: tz, truncado, max_linhas: 20000 },
    };
  }

  /**
   * rel 45 `VendasProdutosPorArea` e rel 47 `VendasProdutosPorAreaDepartamento` («Vendas × m²») — a venda
   * medida contra a ÁREA física (m²) das famílias (FAMILIAS_PROD_AREA, mig 146; 1 linha no golden).
   * ⚠️ BUG DO LEGADO COPIADO: o join da área de SUBGRUPO usa `ASG.CODFAMILIA = P.CODGRUPO` (o GRUPO de novo)
   * nas DUAS variantes — a área de subgrupo exibida é a do grupo. E a rel 45 filtra a empresa nos joins de
   * área; a rel 47 NÃO filtra (copiado como cada uma faz). O interno agrupa por CODVENDAS ⇒ colapsa.
   * A rel 47 acrescenta PERC_TOTAL_FATURADO = venda da linha ÷ total da EMPRESA ×100 (o TOTALIZADORES CTE).
   */
  async porArea(f: FiltroExtras, comParticipacao: boolean) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { bruto, acresc, desc } = this.forms();
    let q = db.selectFrom('vendas as v')
      .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
      .leftJoin('familias_prod as d', 'd.codfamilia', 'p.coddpto')
      .leftJoin('familias_prod as g', 'g.codfamilia', 'p.codgrupo')
      .leftJoin('familias_prod as sg', 'sg.codfamilia', 'p.codsubgrupo')
      .leftJoin('familias_prod as sc', 'sc.codfamilia', 'p.codsecao')
      .leftJoin('familias_prod_area as ad', (j) => comParticipacao
        ? j.on(sql<boolean>`ad.codfamilia = p.coddpto`)
        : j.on(sql<boolean>`ad.codfamilia = p.coddpto and ad.idempresa = ${emp}`))
      .leftJoin('familias_prod_area as ag', (j) => comParticipacao
        ? j.on(sql<boolean>`ag.codfamilia = p.codgrupo`)
        : j.on(sql<boolean>`ag.codfamilia = p.codgrupo and ag.idempresa = ${emp}`))
      // ⚠️ o BUG: área de subgrupo pelo CODGRUPO — fiel às duas variantes
      .leftJoin('familias_prod_area as asg', (j) => comParticipacao
        ? j.on(sql<boolean>`asg.codfamilia = p.codgrupo`)
        : j.on(sql<boolean>`asg.codfamilia = p.codgrupo and asg.idempresa = ${emp}`))
      .leftJoin('familias_prod_area as asec', (j) => comParticipacao
        ? j.on(sql<boolean>`asec.codfamilia = p.codsecao`)
        : j.on(sql<boolean>`asec.codfamilia = p.codsecao and asec.idempresa = ${emp}`))
      .select([
        'p.idproduto', 'p.codbarra', sql`p.descricao`.as('descricao'), sql`p.unidade`.as('unidade'),
        sql`d.descricao`.as('depto'), sql`g.descricao`.as('grupo'), sql`sg.descricao`.as('subgrupo'), sql`sc.descricao`.as('secao'),
        sql`max(ad.area)`.as('area_depto'), sql`max(ag.area)`.as('area_grupo'),
        sql`max(asg.area)`.as('area_subgrupo'), sql`max(asec.area)`.as('area_secao'),
        sql`round(sum(coalesce(v.qtde,0))::numeric, 3)`.as('qtde'),
        sql`round((sum(${bruto}) + sum(${acresc}) - sum(${desc}))::numeric, 2)`.as('total_venda'),
        sql`round(sum(round((coalesce(v.qtde,0) * coalesce(v.vrcusto,0))::numeric, 2))::numeric, 2)`.as('total_custo'),
      ]);
    q = this.aplicar(q, f, emp, tz, ate);
    const rows = (await q.groupBy(['p.idproduto', 'p.codbarra', 'p.descricao', 'p.unidade',
      sql`d.descricao`, sql`g.descricao`, sql`sg.descricao`, sql`sc.descricao`])
      .orderBy(sql`sc.descricao`).orderBy(sql`d.descricao`).orderBy(sql`p.descricao`)
      .limit(20001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 20000;
    const base = truncado ? rows.slice(0, 20000) : rows;
    const totalEmpresa = r2(base.reduce((s2, r) => s2 + num(r.total_venda), 0));
    const linhas: Record<string, unknown>[] = base.map((r) => {
      const venda = r2(num(r.total_venda)); const custo = r2(num(r.total_custo));
      return { ...r, qtde: num(r.qtde), total_venda: venda, total_custo: custo,
        lucro: r2(venda - custo),
        // rel 47: participação no faturado da empresa (o TOTALIZADORES do legado)
        ...(comParticipacao ? { perc_total_faturado: totalEmpresa !== 0 ? r2((venda / totalEmpresa) * 100) : null } : {}),
        // venda por m² (a leitura do «Vendas × m²»): usa a área mais específica disponível
        venda_por_m2: (() => {
          const area = num(r.area_subgrupo) || num(r.area_grupo) || num(r.area_depto) || num(r.area_secao);
          return area > 0 ? r2(venda / area) : null;
        })() };
    });
    return {
      linhas,
      totais: { linhas: linhas.length, total_venda: totalEmpresa },
      filtro: { ...f, empresa: emp, fuso: tz, truncado, max_linhas: 20000 },
    };
  }

  /**
   * rel 43 `EspelhoReducaoZ` — o espelho da Redução Z reconstruído das VENDAS: três seções por (dia × PDV):
   *   'ICMS'      → por alíquota: venda bruta, cancelado, desconto, líquida e o ICMS calculado
   *   ' TOTAL'    → o agregado do PDV no dia
   *   'PAGAMENTO' → por OPERACAO de CX_VENDAS
   * O PDV e a operação vêm de **CX_VENDAS via INNER JOIN por NROPEDIDO** — pedido sem pagamento SAI do
   * espelho, e um pedido com N pagamentos multiplica os itens entre as operações (fiel: o legado agrupa por
   * CX.OPERACAO/CX.NROPDV no nível do item). VALOR_ALIQUOTA = DET_ALIQUOTA pela UF da empresa (STB/IST/NTB
   * ⇒ 0, como na rel 40). O cancelado NÃO é filtrado (o espelho MOSTRA o cancelado): TOTAL_CANCELADO usa a
   * fórmula SIMPLES qtde×vrvenda (sem IAT) e a LÍQUIDA = (bruta − cancelado) + acréscimo − desconto.
   */
  async espelhoZ(f: FiltroExtras) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { bruto, acresc, desc } = this.forms();
    const valorAliquota = sql`case when v.aliquota in ('STB','IST','NTB') then 0 else coalesce(da.icm_efetivo,0) end`;
    // nível TEMP: (dia, pdv, alíquota, %ICMS, operação) — o espelho não filtra cancelado
    let temp = db.selectFrom('vendas as v')
      .innerJoin('cx_vendas as cx', 'cx.nropedido', 'v.nropedido')
      .leftJoin('empresas as e', 'e.idempresa', 'v.idempresa')
      .leftJoin('det_aliquota as da', (j) => j.on(sql<boolean>`da.aliquota = v.aliquota and da.uf = e.uf`))
      .select([
        sql`to_char(v.dtvenda at time zone ${tz}, 'YYYY-MM-DD')`.as('dia'),
        sql`cx.nropdv`.as('nropdv'),
        'v.aliquota',
        sql`${valorAliquota}`.as('valor_aliquota'),
        sql`cx.operacao`.as('operacao'),
        sql`round(sum(coalesce(v.qtde,0))::numeric, 3)`.as('qtde'),
        sql`round(sum(${bruto})::numeric, 2)`.as('total_venda'),
        sql`round(sum(case when coalesce(v.cancelado,'N') = 'S'
          then round((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric, 2) else 0 end)::numeric, 2)`.as('total_cancelado'),
        sql`round(sum(${acresc})::numeric, 2)`.as('acrescimo'),
        sql`round(sum(${desc})::numeric, 2)`.as('desconto'),
      ])
      .where('v.idempresa', '=', emp);
    if (f.filtrarHora && f.horaIni && f.horaFim) {
      temp = temp.where('v.dtvenda', '>=', sql`(${`${f.dtini} ${f.horaIni}`}::timestamp at time zone ${tz})`)
        .where('v.dtvenda', '<=', sql`(${`${f.dtfim} ${f.horaFim}`}::timestamp at time zone ${tz})`);
    } else {
      temp = temp.where('v.dtvenda', '>=', sql`(${f.dtini}::timestamp at time zone ${tz})`)
        .where('v.dtvenda', '<', sql`(${ate}::timestamp at time zone ${tz})`);
    }
    temp = temp.groupBy([sql`1`, sql`cx.nropdv`, 'v.aliquota', sql`4`, sql`cx.operacao`]);

    const rows = (await temp.execute()) as Record<string, unknown>[];
    // as 3 seções, na ordem do espelho: dia → pdv → (ICMS por alíquota, TOTAL, PAGAMENTO por operação)
    type Sec = Record<string, unknown>;
    const porChave = new Map<string, Sec[]>();
    for (const r of rows) {
      const k = `${r.dia}#${r.nropdv ?? ''}`;
      if (!porChave.has(k)) porChave.set(k, []);
      porChave.get(k)!.push(r);
    }
    const linhas: Sec[] = [];
    const liq = (r: Sec) => r2(num(r.total_venda) - num(r.total_cancelado) + num(r.acrescimo) - num(r.desconto));
    for (const k of [...porChave.keys()].sort()) {
      const grupo = porChave.get(k)!;
      const [dia, nropdv] = k.split('#');
      // ICMS por alíquota
      const porAliq = new Map<string, Sec>();
      for (const r of grupo) {
        const ka = String(r.aliquota ?? '');
        const at = porAliq.get(ka) ?? { tipo: 'ICMS', dia, nropdv, aliquota: ka, valor_aliquota: num(r.valor_aliquota), total_venda: 0, total_cancelado: 0, desconto: 0, total_venda_liquida: 0, valor_icms: 0 };
        at.total_venda = r2(num(at.total_venda) + num(r.total_venda));
        at.total_cancelado = r2(num(at.total_cancelado) + num(r.total_cancelado));
        at.desconto = r2(num(at.desconto) + num(r.desconto));
        at.total_venda_liquida = r2(num(at.total_venda_liquida) + liq(r));
        at.valor_icms = r2(num(at.valor_icms) + r2(liq(r) * num(r.valor_aliquota) / 100));
        porAliq.set(ka, at);
      }
      const aliqs = [...porAliq.values()].sort((a, b) => String(a.aliquota).localeCompare(String(b.aliquota)));
      linhas.push(...aliqs);
      // TOTAL do PDV no dia
      linhas.push({
        tipo: ' TOTAL', dia, nropdv, aliquota: '  TOTAL',
        total_venda: r2(aliqs.reduce((s2, a) => s2 + num(a.total_venda), 0)),
        total_cancelado: r2(aliqs.reduce((s2, a) => s2 + num(a.total_cancelado), 0)),
        desconto: r2(aliqs.reduce((s2, a) => s2 + num(a.desconto), 0)),
        total_venda_liquida: r2(aliqs.reduce((s2, a) => s2 + num(a.total_venda_liquida), 0)),
        valor_icms: r2(aliqs.reduce((s2, a) => s2 + num(a.valor_icms), 0)),
      });
      // PAGAMENTO por operação
      const porOp = new Map<string, number>();
      for (const r of grupo) {
        const ko = String(r.operacao ?? '');
        porOp.set(ko, r2((porOp.get(ko) ?? 0) + liq(r)));
      }
      for (const [op, v] of [...porOp.entries()].sort()) {
        linhas.push({ tipo: 'PAGAMENTO', dia, nropdv, aliquota: op, total_venda_liquida: v });
      }
    }
    return {
      linhas,
      totais: { dias_pdv: porChave.size, linhas: linhas.length },
      filtro: { ...f, empresa: emp, fuso: tz },
    };
  }

}
