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
}
