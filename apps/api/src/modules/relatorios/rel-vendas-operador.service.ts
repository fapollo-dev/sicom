import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroOperador {
  dtini: string; dtfim: string;
  horaIni?: string; horaFim?: string; filtrarHora?: boolean;
  canceladas?: 'N' | 'S' | 'T';
  promocao?: 'S' | 'N' | 'T';
  produto?: string; fornecedor?: string;
  departamentos?: number[]; grupos?: number[]; subgrupos?: number[]; secoes?: number[];
  aliquota?: string;
  exibirFilhos?: boolean;
}

/**
 * FAMÍLIA OPERADOR/VENDEDOR do hub FRMRELVENDAS — cinco variantes num serviço, cada uma fiel ao SEU SQL:
 *
 *   rel 06 `VendasDataporOperador`   → dia × OPERADOR (caixa): total + nº de cupons distintos
 *   rel 19 `VendasResumoporOperador` → resumo por OPERADOR: dias trabalhados, cupons, média/dia, ticket
 *   rel 25 `VendasDetalhePorOperador`→ ⚠️ o NOME MENTE: agrupa por VENDEDOR (grupo/sub/seção/produto)
 *   rel 36 `VendasDataporVendedor`   → total por VENDEDOR no período
 *   rel 46 `ProdutosVendidosPeriodoPorOperador` → o molde da rel 01 com o OPERADOR na chave
 *
 * FIDELIDADES POR VARIANTE (cada uma tem as suas — não uniformizar):
 *  · rel 06/25 têm `AND CANCELADO='N'` **HARDCODED** além do filtro do frame: escolher "só canceladas" no
 *    frame produz N∧S = vazio no legado. Copiado: o parâmetro `canceladas` é ignorado nessas duas (sempre N).
 *  · rel 06 junta FAMILIAS_PROD por **P.**COD* (cadastro de hoje); rel 19/36 por **V.**COD* (snapshot da
 *    venda). Diferença real quando o produto mudou de família depois da venda.
 *  · rel 19: o nível interno agrupa por (empresa, nome, NROCUPOM, **DTVENDA CRUA**) — um cupom com timestamps
 *    diferentes vira VÁRIOS grupos internos. `NROCUPONS` usa COUNT(DISTINCT), mas o **TICKET_MEDIO divide por
 *    COUNT(NROCUPOM) NÃO-distinto** (conta os grupos internos) ⇒ os dois denominadores divergem de propósito.
 *    E a coluna que o legado chama `DESC_PROMOCAO` é na verdade **ACRESCIMO − DESCONTO** (o ajuste líquido,
 *    nome mente). MEDIA = total ÷ dias trabalhados; ORDER BY MEDIA DESC.
 *  · rel 25: **INNER JOIN** em produtos e no PARCEIRO do vendedor ⇒ venda sem vendedor ou sem cadastro de
 *    produto SAI do relatório (nas outras é LEFT). `vrvenda` é SOMA DE UNITÁRIOS (exposto como
 *    `soma_vrvenda_uni`).
 *  · rel 36: os dois níveis colapsam (o interno agrupa por TODAS as colunas-medida cruas ⇒ partição exaustiva
 *    e a soma externa ≡ soma simples). SEM «Filtrar Hora» o legado ignora a hora (dias inteiros).
 *  · rel 46: o interno agrupa por CODVENDAS (a PK) ⇒ colapsa como a rel 01 (mesma prova). MARGEM aqui é
 *    **participação do custo** (custo/venda×100, NULLIF ⇒ branco), RENTABILIDADE com NULLIF, DESC_ACRE é só
 *    `desc_acre_medio` cru, unitários = SUM(TOTAL)/SUM(QTDE) (protegidos com NULLIF ⇒ null, fold nosso
 *    documentado — o legado dividiria cru), soma de unitários VRCUSTO/VRVENDA por LINHA, «Exibir produtos
 *    filhos» suportado. ORDER BY empresa, codoperador, descricao.
 *
 * `TRUNC(DTVENDA)` sempre no fuso da config (lição 17).
 */
@Injectable()
export class RelVendasOperadorService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async ctx(f: FiltroOperador) {
    const emp = this.emp();
    if (!f.dtini || !f.dtfim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    if (String(f.dtini) > String(f.dtfim)) throw new BusinessRuleError('PERIODO_INVERTIDO', { dtini: f.dtini, dtfim: f.dtfim });
    const tz = String((await this.config.resolver('FUSO_HORARIO_ACESSO', { empresaId: emp })) ?? 'America/Sao_Paulo');
    const fimExcl = new Date(`${f.dtfim}T00:00:00Z`);
    if (Number.isNaN(fimExcl.getTime())) throw new BusinessRuleError('PERIODO_INVALIDO', { dtfim: f.dtfim });
    fimExcl.setUTCDate(fimExcl.getUTCDate() + 1);
    return { emp, tz, ate: fimExcl.toISOString().slice(0, 10), db: this.dbp.forTenantRead() as AnyDB };
  }

  /** fórmulas por item — as mesmas do hub inteiro */
  private forms() {
    const bruto = sql`case when coalesce(v.iat,'') = 'A'
      then round((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric, 2)
      else trunc((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric * 100) / 100 end`;
    const acresc = sql`greatest(coalesce(v.desc_acre_medio,0),0) + greatest(coalesce(v.desc_acre_item,0),0)`;
    const desc = sql`coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
      + abs(least(coalesce(v.desc_acre_medio,0),0)) + abs(least(coalesce(v.desc_acre_item,0),0))`;
    return { bruto, acresc, desc, liquido: sql`sum(${bruto}) + sum(${acresc}) - sum(${desc})` };
  }

  /** frame comum: período (+hora contínua), cancelado, promoção, filtros de produto/família. */
  private aplicar<Q extends { where: (...a: any[]) => Q }>(
    q: Q, f: FiltroOperador, emp: number, tz: string, ate: string,
    opts: { cancelHard?: boolean; diasInteiros?: boolean } = {},
  ): Q {
    let r = q.where('v.idempresa', '=', emp);
    if (!opts.diasInteiros && f.filtrarHora && f.horaIni && f.horaFim) {
      r = r.where('v.dtvenda', '>=', sql`(${`${f.dtini} ${f.horaIni}`}::timestamp at time zone ${tz})`)
        .where('v.dtvenda', '<=', sql`(${`${f.dtfim} ${f.horaFim}`}::timestamp at time zone ${tz})`);
    } else {
      r = r.where('v.dtvenda', '>=', sql`(${f.dtini}::timestamp at time zone ${tz})`)
        .where('v.dtvenda', '<', sql`(${ate}::timestamp at time zone ${tz})`);
    }
    // rel 06/25: CANCELADO='N' hardcoded no SQL ALÉM do filtro do frame — os dois se SOMAM no legado, então
    // pedir "só canceladas" produz N∧S = vazio. Fiel: aplica o hardcode E o parâmetro.
    if (opts.cancelHard) r = r.where(sql<boolean>`coalesce(v.cancelado,'N') = 'N'`);
    const canc = f.canceladas ?? 'N';
    if (canc === 'N') r = r.where(sql<boolean>`coalesce(v.cancelado,'N') = 'N'`);
    else if (canc === 'S') r = r.where(sql<boolean>`coalesce(v.cancelado,'N') = 'S'`);
    if (f.promocao === 'S') r = r.where('v.promocao', '=', 'S');
    if (f.promocao === 'N') r = r.where('v.promocao', '=', 'N');
    if (f.produto) r = r.where(sql<boolean>`upper(p.descricao) like ${`%${f.produto.toUpperCase()}%`}`);
    if (f.fornecedor) r = r.where(sql<boolean>`upper(forn.razao) like ${`%${f.fornecedor.toUpperCase()}%`}`);
    if (f.departamentos?.length) r = r.where('p.coddpto', 'in', f.departamentos.map(Number));
    if (f.grupos?.length) r = r.where('p.codgrupo', 'in', f.grupos.map(Number));
    if (f.subgrupos?.length) r = r.where('p.codsubgrupo', 'in', f.subgrupos.map(Number));
    if (f.secoes?.length) r = r.where('p.codsecao', 'in', f.secoes.map(Number));
    if (f.aliquota) r = r.where(sql<boolean>`v.aliquota like ${`%${f.aliquota}%`}`);
    return r;
  }

  /** rel 06 — dia × operador. CANCELADO='N' fixo; COUNT(DISTINCT nrocupom); junta família por P. */
  async dataOperador(f: FiltroOperador) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { liquido } = this.forms();
    const q = this.aplicar(
      db.selectFrom('vendas as v')
        .leftJoin('operadores as o', 'o.codoperador', 'v.operador')
        .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
        .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
        .select([
          sql`to_char(v.dtvenda at time zone ${tz}, 'YYYY-MM-DD')`.as('dia'),
          sql`o.nome`.as('nome'),
          sql`count(distinct v.nrocupom)`.as('nrocupons'),
          sql`round((${liquido})::numeric, 2)`.as('total_venda'),
        ]),
      f, emp, tz, ate, { cancelHard: true },
    ).groupBy([sql`1`, sql`o.nome`]).orderBy(sql`1`).orderBy(sql`o.nome`);
    const rows = (await q.execute()) as Record<string, unknown>[];
    const linhas: Record<string, unknown>[] = rows.map((r) => ({ ...r, nrocupons: Number(r.nrocupons ?? 0), total_venda: r2(num(r.total_venda)) }));
    return {
      linhas,
      totais: {
        total_venda: r2(linhas.reduce((s, l) => s + num(l.total_venda), 0)),
        cupons: linhas.reduce((s, l) => s + Number(l.nrocupons ?? 0), 0),
        operadores: new Set(linhas.map((l) => l.nome)).size,
      },
      filtro: { ...f, empresa: emp, fuso: tz, canceladas: 'N' },
    };
  }

  /** rel 19 — resumo por operador: dias, cupons, média/dia, ticket (denominador NÃO-distinto, fiel). */
  async resumoOperador(f: FiltroOperador) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { bruto, acresc, desc } = this.forms();
    // nível interno: (empresa, nome, nrocupom, DTVENDA CRUA) — o timestamp cru divide o cupom (fiel)
    const interno = this.aplicar(
      db.selectFrom('vendas as v')
        .leftJoin('operadores as o', 'o.codoperador', 'v.operador')
        .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
        .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
        .select([
          sql`o.nome`.as('nome'),
          sql`to_char(v.dtvenda at time zone ${tz}, 'YYYY-MM-DD')`.as('dia'),
          'v.nrocupom',
          sql`sum(${bruto})`.as('total_venda'),
          sql`sum(${acresc})`.as('acrescimo'),
          sql`sum(${desc})`.as('desc_promocao'),
          sql`sum(coalesce(v.qtde,0))`.as('totqtd'),
        ]),
      f, emp, tz, ate,
    ).groupBy([sql`o.nome`, sql`2`, 'v.nrocupom', 'v.dtvenda']);
    const externo = db.selectFrom(interno.as('v')).select([
      sql`v.nome`.as('nome'),
      sql`count(distinct v.dia)`.as('dias_trabalhados'),
      sql`round(sum(v.total_venda + v.acrescimo - v.desc_promocao)::numeric, 2)`.as('total_venda'),
      sql`count(distinct v.nrocupom)`.as('nrocupons'),
      // a coluna que o legado ROTULA "DESC_PROMOCAO": é o ajuste LÍQUIDO acréscimo − desconto
      sql`round(sum(v.acrescimo - v.desc_promocao)::numeric, 2)`.as('ajuste_liquido'),
      // ticket: divide por COUNT NÃO-distinto (grupos internos = cupom × timestamp) — fiel
      sql`round((sum(v.total_venda + v.acrescimo - v.desc_promocao) / nullif(count(v.nrocupom),0))::numeric, 2)`.as('ticket_medio'),
      sql`round((sum(v.total_venda + v.acrescimo - v.desc_promocao) / nullif(count(distinct v.dia),0))::numeric, 2)`.as('media'),
      sql`round(sum(v.totqtd)::numeric, 2)`.as('totqtd'),
      sql`count(v.nrocupom)`.as('grupos_internos'),
    ]).groupBy(sql`v.nome`);
    // ORDER BY MEDIA DESC do legado — aplicado no wrapper p/ ordenar pelo alias já materializado
    const rows = (await db.selectFrom(externo.as('x')).selectAll().orderBy(sql`x.media desc nulls last`).execute()) as Record<string, unknown>[];
    const linhas = rows.map((r) => ({
      ...r,
      dias_trabalhados: Number(r.dias_trabalhados ?? 0), nrocupons: Number(r.nrocupons ?? 0),
      grupos_internos: Number(r.grupos_internos ?? 0),
      total_venda: r2(num(r.total_venda)), ajuste_liquido: r2(num(r.ajuste_liquido)),
      ticket_medio: r.ticket_medio == null ? null : r2(num(r.ticket_medio)),
      media: r.media == null ? null : r2(num(r.media)), totqtd: num(r.totqtd),
    }));
    return {
      linhas,
      totais: {
        total_venda: r2(linhas.reduce((s, l) => s + num(l.total_venda), 0)),
        cupons: linhas.reduce((s, l) => s + Number(l.nrocupons ?? 0), 0),
        operadores: linhas.length,
      },
      filtro: { ...f, empresa: emp, fuso: tz },
    };
  }

  /** rel 25 — detalhe por VENDEDOR (o nome da variante mente). INNER joins; CANCELADO='N' fixo. */
  async detalheVendedor(f: FiltroOperador) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const q = this.aplicar(
      db.selectFrom('vendas as v')
        .innerJoin('produtos as p', 'p.idproduto', 'v.codproduto')
        .innerJoin('parceiros as ve', 've.codparceiro', 'v.codvendedor')
        .leftJoin('familias_prod as g', 'g.codfamilia', 'p.codgrupo')
        .leftJoin('familias_prod as gs', 'gs.codfamilia', 'p.codsubgrupo')
        .leftJoin('familias_prod as sc', 'sc.codfamilia', 'p.codsecao')
        .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
        .select([
          'p.codgrupo', sql`g.descricao`.as('desgrupo'),
          'p.codsubgrupo', sql`gs.descricao`.as('dessubgrupo'),
          'p.codsecao', sql`sc.descricao`.as('secao'),
          'v.codvendedor', sql`ve.razao`.as('nomvendedor'),
          'v.codproduto', sql`p.descricao`.as('desproduto'), 'v.unidade',
          sql`round(sum(coalesce(v.qtde,0))::numeric, 3)`.as('qtde'),
          // SUM(V.VRVENDA) do legado = soma de UNITÁRIOS — nome explícito
          sql`round(sum(coalesce(v.vrvenda,0))::numeric, 2)`.as('soma_vrvenda_uni'),
        ]),
      f, emp, tz, ate, { cancelHard: true },
    ).groupBy(['p.codgrupo', 'g.descricao', 'p.codsubgrupo', 'gs.descricao', 'p.codsecao', 'sc.descricao',
      'v.codvendedor', 've.razao', 'v.codproduto', 'p.descricao', 'v.unidade'])
      .orderBy('p.codgrupo').orderBy('p.codsubgrupo').orderBy('v.codvendedor')
      .limit(20001);
    const brutas = (await q.execute()) as Record<string, unknown>[];
    const truncado = brutas.length > 20000;
    const linhas: Record<string, unknown>[] = (truncado ? brutas.slice(0, 20000) : brutas).map((r) => ({
      ...r, qtde: num(r.qtde), soma_vrvenda_uni: r2(num(r.soma_vrvenda_uni)),
    }));
    return {
      linhas,
      totais: { linhas: linhas.length, vendedores: new Set(linhas.map((l) => l.codvendedor)).size },
      filtro: { ...f, empresa: emp, fuso: tz, canceladas: 'N', truncado, max_linhas: 20000 },
    };
  }

  /** rel 36 — total por vendedor (colapsa p/ uma passada; sem hora = dias inteiros). */
  async dataVendedor(f: FiltroOperador) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { liquido } = this.forms();
    const q = this.aplicar(
      db.selectFrom('vendas as v')
        .leftJoin('parceiros as ve', 've.codparceiro', 'v.codvendedor')
        .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
        .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
        .select([
          sql`ve.razao`.as('nome'),
          sql`round((${liquido})::numeric, 2)`.as('total_venda'),
        ]),
      f, emp, tz, ate, { diasInteiros: !f.filtrarHora },
    ).groupBy(sql`ve.razao`).orderBy(sql`ve.razao`);
    const rows = (await q.execute()) as Record<string, unknown>[];
    const linhas = rows.map((r) => ({ nome: r.nome, total_venda: r2(num(r.total_venda)) }));
    return {
      linhas,
      totais: { total_venda: r2(linhas.reduce((s, l) => s + num(l.total_venda), 0)), vendedores: linhas.length },
      filtro: { ...f, empresa: emp, fuso: tz },
    };
  }

  /** rel 46 — produtos vendidos × operador (molde da rel 01; margem = participação do custo). */
  async produtosOperador(f: FiltroOperador) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { bruto, acresc, desc } = this.forms();
    const chaveProduto = f.exibirFilhos ? sql`coalesce(v.idproduto_filho, v.codproduto)` : sql`v.codproduto`;
    const q = this.aplicar(
      db.selectFrom('vendas as v')
        .leftJoin('operadores as o', 'o.codoperador', 'v.operador')
        .leftJoin('produtos as p', (j) => j.on(sql<boolean>`p.idproduto = ${chaveProduto}`))
        .leftJoin('familias_prod as d', 'd.codfamilia', 'p.coddpto')
        .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
        .select([
          'o.codoperador', sql`o.nome`.as('nome'),
          'p.idproduto', 'p.codbarra', sql`p.descricao`.as('descricao'), 'p.unidade',
          sql`d.descricao`.as('departamento'),
          sql`round(sum(coalesce(v.qtde,0))::numeric, 3)`.as('qtde'),
          sql`sum(${bruto})`.as('bruto'),
          sql`round(sum(${acresc})::numeric, 2)`.as('acrescimo'),
          sql`round(sum(${desc})::numeric, 2)`.as('desc_promocao'),
          sql`round(sum(round((coalesce(v.qtde,0) * coalesce(v.vrcusto,0))::numeric, 2))::numeric, 2)`.as('total_custo'),
          // DESC_ACRE da rel 46 = só desc_acre_medio, cru e assinado (como a rel 38)
          sql`round(sum(coalesce(v.desc_acre_medio,0))::numeric, 2)`.as('desc_acre'),
          sql`round(sum(coalesce(v.vrcusto,0))::numeric, 2)`.as('soma_vrcusto_uni'),
          sql`round(sum(coalesce(v.vrvenda,0))::numeric, 2)`.as('soma_vrvenda_uni'),
        ]),
      f, emp, tz, ate,
    ).groupBy(['o.codoperador', sql`o.nome`, 'p.idproduto', 'p.codbarra', 'p.descricao', 'p.unidade', sql`d.descricao`])
      .orderBy('o.codoperador').orderBy(sql`p.descricao`)
      .limit(20001);
    const brutas = (await q.execute()) as Record<string, unknown>[];
    const truncado = brutas.length > 20000;
    const linhas = (truncado ? brutas.slice(0, 20000) : brutas).map((r) => {
      const venda = r2(num(r.bruto) + num(r.acrescimo) - num(r.desc_promocao));
      const custo = r2(num(r.total_custo));
      const qt = num(r.qtde);
      return {
        codoperador: r.codoperador, nome: r.nome, idproduto: r.idproduto, codbarra: r.codbarra,
        descricao: r.descricao, unidade: r.unidade, departamento: r.departamento,
        qtde: qt,
        total_venda: venda, total_custo: custo,
        lucro: r2(venda - custo),
        acrescimo: r2(num(r.acrescimo)), desc_promocao: r2(num(r.desc_promocao)), desc_acre: r2(num(r.desc_acre)),
        soma_vrcusto_uni: r2(num(r.soma_vrcusto_uni)), soma_vrvenda_uni: r2(num(r.soma_vrvenda_uni)),
        // MARGEM da rel 46 = participação do custo (NULLIF ⇒ branco); RENTABILIDADE idem
        margem: venda !== 0 ? r2((custo / venda) * 100) : null,
        rentabilidade: venda !== 0 ? r2(((venda - custo) / venda) * 100) : null,
        // unitários SUM(TOTAL)/SUM(QTDE) — NULLIF nosso documentado (o legado divide cru e estouraria)
        vrvenda_uni: qt !== 0 ? r2(venda / qt) : null,
        vrcusto_uni: qt !== 0 ? r2(custo / qt) : null,
      };
    });
    const totalVenda = r2(linhas.reduce((s, l) => s + num(l.total_venda), 0));
    const totalCusto = r2(linhas.reduce((s, l) => s + num(l.total_custo), 0));
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        operadores: new Set(linhas.map((l) => l.codoperador)).size,
        total_venda: totalVenda, total_custo: totalCusto, lucro: r2(totalVenda - totalCusto),
      },
      filtro: { ...f, empresa: emp, fuso: tz, truncado, max_linhas: 20000 },
    };
  }
}
