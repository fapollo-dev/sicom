import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { RelVendasService } from './rel-vendas.service';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const TIPOS_REL_AGENDA = ['agenda', 'vendidos', 'tv', 'radio', 'tabloide', 'interno', 'totais', 'totais-itens', 'por-loja', 'fim-promocao', 'inativos'] as const;
export type TipoRelAgenda = (typeof TIPOS_REL_AGENDA)[number];

export interface FiltroRelAgenda {
  tipo: TipoRelAgenda;
  /** o diálogo de período (frmPeriodoRelAgenda) abre com as datas da agenda; no "fim da promoção" só a data final vale */
  dtini?: string;
  dtfim?: string;
  /** as horas vêm de mskHoraInicio/mskHoraFim = a hora do início/fim da agenda (uCadAgendaPromocao.pas:880-882) */
  horaIni?: string;
  horaFim?: string;
  /** GetMultiEmpresa — recortadas às lojas do operador; vazio = a do login */
  empresas?: number[];
  /** o filtro "Exibir produtos" da grade (RdgExibirProdutosAtivos, padrão Ambos) — entra só nos relatórios por mídia */
  exibir?: 'S' | 'N' | 'T';
  /** imprimir a agenda agrupada por departamento — no legado é config da ESTAÇÃO ("AGENDA DE PROMOCAO AGRUPAR VALORES PELO
   *  DEPARTAMENTO", ConfigDB.xml local, não no banco; ausente = o leiaute simples) — aqui, a escolha na hora de imprimir */
  agrupar?: 'S' | 'N';
}

/** a coluna de mídia de cada relatório "oferta em …" (GeralRel: `FiltroPadrao + ' AND TV = ''T'''`, :1891-1909) */
const MIDIA: Partial<Record<TipoRelAgenda, 'tv' | 'radio' | 'tabloide' | 'interno'>> = { tv: 'tv', radio: 'radio', tabloide: 'tabloide', interno: 'interno' };

/**
 * RELATÓRIOS DA AGENDA DE PROMOÇÃO (uCadAgendaPromocao — menu "Outros", `GeralRel` :1844-2272, `GerarRelProdInativos`).
 * Todos, menos o "fim da promoção" e os inativos, filtram as VENDAS pelos produtos da agenda (`AND V.CODPRODUTO IN (…)
 * AND CANCELADO = 'N'`) numa JANELA CONTÍNUA data+hora (TVendas com QuebraHora = True):
 *  - vendidos / oferta em TV · rádio · tabloide · interna → `TVendas.GetSQL(1)` (o rel 01 do hub, RelVendasService) +
 *    o resumo por departamento `GetSQL(1000)` (o `frxDBDatasetD` do layout — o `cdsDeptoGrupo` montado no código não é
 *    impresso). Nos de mídia os itens passam pelo filtro da grade (ATUALIZACAO_GRUPO <> 'S' + "Exibir produtos") e pela
 *    flag; no "vendidos" o filtro é DESLIGADO (`Filtered := False`) → todos os itens da agenda.
 *  - totais / totais com itens → `GetSQL(1001/1002)`: só venda em promoção; a diferença é contra o preço de venda ATUAL
 *    do MULTI_PRECO (não o da data da venda — fiel).
 *  - por loja → `GetSQL(22)`: a venda em promoção por loja × produto (o layout pivota Q/C/V por loja).
 *  - fim da promoção → itens das agendas ABERTAS/EXECUTANDO (A/E/N) da loja que terminam na data.
 *  - inativos → itens ATIVO='N' desta agenda (agenda aberta), com o preço da loja.
 */
@Injectable()
export class AgendaPromocaoRelService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly relVendas: RelVendasService,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** GetMultiEmpresa → RELACAO_OPERADOR_EMPRESA (a do login sempre entra) */
  private async permitidas(db: AnyDB): Promise<number[]> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const rel = op == null ? [] : ((await db.selectFrom('relacao_operador_empresa').select('codempresa').where('codoperador', '=', op).execute()) as Array<{ codempresa: number }>).map((r) => Number(r.codempresa));
    return [...new Set([emp, ...rel])];
  }

  async relatorio(codagenda: number, f: FiltroRelAgenda): Promise<Record<string, unknown>> {
    if (!TIPOS_REL_AGENDA.includes(f.tipo)) throw new BusinessRuleError('RELATORIO_TIPO_INVALIDO', { tipo: f.tipo });
    const db = this.dbp.forTenantRead() as AnyDB;
    const emp = this.emp();
    const ag = (await db.selectFrom('agenda_promocao')
      .select(['codagenda', 'nomepromo', 'flagpromocao',
        sql<string>`to_char(dtiniciopromocao AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`.as('dtini'),
        sql<string>`to_char(dtfimpromocao AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`.as('dtfim'),
        sql<string>`to_char(dtiniciopromocao AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')`.as('hini'),
        sql<string>`to_char(dtfimpromocao AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')`.as('hfim')])
      .where('codagenda', '=', codagenda).where(sql`coalesce(indr, 'I')`, '<>', 'E')
      .executeTakeFirst()) as { codagenda: number; nomepromo: string | null; flagpromocao: string | null; dtini: string; dtfim: string; hini: string; hfim: string } | undefined;
    if (!ag) throw new BusinessRuleError('AGENDA_NAO_ENCONTRADA', { codagenda });
    const agenda = { codagenda: ag.codagenda, nomepromo: ag.nomepromo };
    if (f.tipo === 'agenda') return { agenda: { ...agenda, flagpromocao: ag.flagpromocao, dtini: ag.dtini, hini: ag.hini, dtfim: ag.dtfim, hfim: ag.hfim }, tipo: f.tipo, ...(await this.imprimirAgenda(db, emp, codagenda, f)) };

    if (f.tipo === 'inativos') return { agenda, tipo: f.tipo, linhas: await this.itensComPreco(db, emp, { codagenda, inativos: true }) };
    const dtfim = f.dtfim ?? ag.dtfim;
    if (f.tipo === 'fim-promocao') return { agenda, tipo: f.tipo, data: dtfim, empresa: emp, linhas: await this.itensComPreco(db, emp, { fimEm: dtfim }) };

    const dtini = f.dtini ?? ag.dtini;
    if (dtini > dtfim) throw new BusinessRuleError('PERIODO_INVERTIDO', { dtini, dtfim });
    const horaIni = f.horaIni ?? ag.hini;
    const horaFim = f.horaFim ?? ag.hfim;
    const permitidas = await this.permitidas(db);
    const empresas = (f.empresas?.length ? f.empresas.map(Number) : [emp]).filter((e) => permitidas.includes(e));
    if (!empresas.length) throw new BusinessRuleError('EMPRESA_FORA_DO_ESCOPO', { empresas: f.empresas });

    // os produtos: no "vendidos"/totais/por loja o filtro da grade é desligado (todos os itens); nos de mídia ele vale
    let qi = db.selectFrom('agenda_promocao_itens').select('idproduto').where('codagenda', '=', codagenda).where('idproduto', 'is not', null);
    const midia = MIDIA[f.tipo];
    if (midia) {
      qi = qi.where(sql`coalesce(atualizacao_grupo, 'N')`, '<>', 'S').where(sql.ref(midia), '=', 'T');
      if (f.exibir === 'S' || f.exibir === 'N') qi = qi.where(sql`coalesce(ativo, 'S')`, '=', f.exibir);
    }
    const produtos = [...new Set(((await qi.execute()) as Array<{ idproduto: number }>).map((r) => Number(r.idproduto)))];
    const cab = { agenda, tipo: f.tipo, dtini, dtfim, horaIni, horaFim, empresas };
    const ini = `${dtini} ${horaIni}`;
    const fim = `${dtfim} ${horaFim}`;

    if (f.tipo === 'vendidos' || midia) {
      const r = await this.relVendas.produtosVendidos(
        { dtini, dtfim, horaIni, horaFim, filtrarHora: true, empresas, canceladas: 'N', produtos },
        { empresasPermitidas: permitidas },
      );
      return { ...cab, linhas: r.linhas, totais: r.totais, departamentos: await this.porDepartamento(db, ini, fim, empresas, produtos) };
    }
    if (f.tipo === 'totais' || f.tipo === 'totais-itens') return { ...cab, linhas: await this.rebaixa(db, ini, fim, empresas, produtos, f.tipo === 'totais-itens') };
    return { ...cab, ...(await this.porLoja(db, ini, fim, empresas, produtos)) };
  }

  /**
   * IMPRIMIR A AGENDA (`btnImprimirClick`, uCadAgendaPromocao.pas:787). Os itens são os da GRADE — `sqqAgendaPromocaoItem`:
   * com MULTI_PRECO na loja, ativos ou inativados há até AGENDA_PROMOCAO_DIAS_ITEM_CANCELADO dias — sob o filtro da grade
   * (`ATUALIZACAO_GRUPO <> 'S'`). O leiaute simples (ListagemAgendaPromocao) força "Exibir produtos = Ativos"; o agrupado
   * (RelatorioAgendaPromocaoAgrupadoDepto) imprime a grade como está e soma o VALOR PROMOCIONAL por departamento de TODOS os
   * itens (`sqqVendaPromocaoAgrupado`). Vr. venda = o do item, senão o da loja (`COALESCE(X.VRVENDA, M.VRVENDA)`).
   */
  private async imprimirAgenda(db: AnyDB, emp: number, codagenda: number, f: FiltroRelAgenda) {
    const agrupar = f.agrupar === 'S';
    const diasCfg = Number.parseInt(String((await this.config.resolver('AGENDA_PROMOCAO_DIAS_ITEM_CANCELADO', { empresaId: emp })) ?? ''), 10);
    const dias = Number.isFinite(diasCfg) ? diasCfg : 365;
    const desc2 = sql`coalesce(m.vrdescpreco2, coalesce(z.vrdescpreco2, 0))`;
    let q = db.selectFrom('agenda_promocao_itens as x')
      .leftJoin('produtos as z', 'z.idproduto', 'x.idproduto')
      .innerJoin('multi_preco as m', (j) => j.onRef('m.idproduto', '=', 'x.idproduto').on('m.idempresa', '=', emp))
      .leftJoin('familias_prod as d', (j) => j.onRef('d.codfamilia', '=', 'z.coddpto').on('d.tipo', '=', 'D'))
      .select(['x.codagenda', 'x.idproduto', 'z.codbarra', 'z.descricao', 'z.unidade', sql`d.descricao`.as('depto'), 'x.empresas', 'x.vlrpromocao', 'x.ativo',
        // VRCUSTOREP: o layout ListagemAgendaPromocao (DEFAULT de 06/08/2025) imprime o custo de reposição da loja
        'm.vrcustorep',
        sql`coalesce(x.vrvenda, m.vrvenda)`.as('vrvenda'),
        sql`case when ${desc2} <> 0 then case when z.tpdescpreco2 = 'D' then m.vrvenda + ${desc2}
                                          when z.tpdescpreco2 = 'P' then m.vrvenda + (m.vrvenda * ${desc2} / 100) else 0 end else 0 end`.as('preco2')])
      .where('x.codagenda', '=', codagenda)
      .where((eb) => eb.or([eb('x.ativo', '=', 'S'), eb.and([eb('x.ativo', '=', 'N'), eb('x.dtativo', '>=', sql<Date>`now() - make_interval(days => ${dias})`)])]))
      .where(sql`coalesce(x.atualizacao_grupo, 'N')`, '<>', 'S');
    if (!agrupar) q = q.where('x.ativo', '=', 'S');
    else if (f.exibir === 'S' || f.exibir === 'N') q = q.where('x.ativo', '=', f.exibir);
    const itens = ((await q.orderBy(sql`d.descricao`).orderBy('z.descricao').execute()) as Record<string, unknown>[])
      .map((r) => ({ ...r, vrvenda: r2(num(r.vrvenda)), vlrpromocao: r2(num(r.vlrpromocao)), preco2: r2(num(r.preco2)), vrcustorep: r.vrcustorep == null ? null : num(r.vrcustorep) }));
    if (!agrupar) return { agrupar: false, linhas: itens };
    const departamentos = ((await sql<Record<string, unknown>>`
      SELECT d.descricao AS depto, sum(x.vlrpromocao) AS vr_total_depto
        FROM agenda_promocao_itens x
        LEFT JOIN produtos z ON z.idproduto = x.idproduto
        JOIN multi_preco m ON m.idproduto = x.idproduto AND m.idempresa = ${emp}
        LEFT JOIN familias_prod d ON d.codfamilia = z.coddpto AND d.tipo = 'D'
       WHERE x.codagenda = ${codagenda}
       GROUP BY d.descricao ORDER BY d.descricao`.execute(db)).rows).map((r) => ({ ...r, vr_total_depto: r2(num(r.vr_total_depto)) }));
    return { agrupar: true, linhas: itens, departamentos };
  }

  /** o valor bruto da linha de venda, como o legado arredonda (IAT 'A' = round, senão trunc) */
  private bruto(expr: ReturnType<typeof sql>) {
    return sql`case when coalesce(v.iat, '') = 'A' then round((${expr})::numeric, 2) else trunc((${expr})::numeric * 100) / 100 end`;
  }

  /** `GetSQL(1000)` ProdutosVendidosPeriodoAgendaDpto (uVendas.pas:3056): o resumo por DEPARTAMENTO dos produtos da agenda */
  private async porDepartamento(db: AnyDB, ini: string, fim: string, empresas: number[], produtos: number[]) {
    if (!produtos.length) return [];
    const rows = (await sql<Record<string, unknown>>`
      SELECT d.descricao AS depto,
             sum(x.total_custo) AS total_custo,
             round(sum(x.total_venda + x.acrescimo - x.desc_promocao)::numeric, 2) AS vr_total_venda,
             sum(x.desc_acre) AS desc_acre, sum(x.desc_promocao) AS desc_promocao, sum(x.acrescimo) AS acrescimo
        FROM (SELECT v.codproduto, v.idempresa, v.cancelado,
                     sum(round((coalesce(v.qtde,0) * coalesce(v.vrcusto,0))::numeric, 2)) AS total_custo,
                     sum(${this.bruto(sql`coalesce(v.qtde,0) * coalesce(v.vrvenda,0)`)}) AS total_venda,
                     sum(round(coalesce(v.desc_acre_medio,0)::numeric, 2)) AS desc_acre,
                     sum(greatest(coalesce(v.desc_acre_medio,0),0) + greatest(coalesce(v.desc_acre_item,0),0)) AS acrescimo,
                     sum(coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
                         + abs(least(coalesce(v.desc_acre_medio,0),0)) + abs(least(coalesce(v.desc_acre_item,0),0))) AS desc_promocao
                FROM vendas v
               WHERE v.dtvenda >= ${ini}::timestamptz AND v.dtvenda <= ${fim}::timestamptz
                 AND v.idempresa IN (${sql.join(empresas)})
               GROUP BY v.codproduto, v.idempresa, v.cancelado) x
        LEFT JOIN produtos p ON p.idproduto = x.codproduto
        LEFT JOIN familias_prod d ON d.codfamilia = p.coddpto
       WHERE x.codproduto IN (${sql.join(produtos)}) AND x.cancelado = 'N'
       GROUP BY d.descricao
       ORDER BY d.descricao`.execute(db)).rows;
    return rows.map((r) => ({ ...r, total_custo: r2(num(r.total_custo)), vr_total_venda: r2(num(r.vr_total_venda)), desc_acre: r2(num(r.desc_acre)), desc_promocao: r2(num(r.desc_promocao)), acrescimo: r2(num(r.acrescimo)) }));
  }

  /**
   * `GetSQL(1001/1002)` CadAgendaVendaRebaixa(Itens) (uVendas.pas:159-266): a venda EM PROMOÇÃO dos produtos da agenda e
   * quanto ela deixou de faturar contra o preço de venda do MULTI_PRECO — o de HOJE, não o da data da venda (fiel).
   * O percentual divide pelo total vendido; o legado estoura com total 0 — aqui sai nulo.
   */
  private async rebaixa(db: AnyDB, ini: string, fim: string, empresas: number[], produtos: number[], itens: boolean) {
    if (!produtos.length) return [];
    const venda = this.bruto(sql`v.qtde * v.vrvenda`);
    const dif = this.bruto(sql`v.qtde * (m.vrvenda - v.vrvenda)`);
    const rows = (await sql<Record<string, unknown>>`
      SELECT ${itens ? sql`p.codbarra, p.idproduto, p.descricao,` : sql``}
             sum(${venda}) AS vr_total_venda, sum(v.qtde) AS qtde, sum(${dif}) AS vr_total_dif_venda_promo, v.promocao
        FROM vendas v
        LEFT JOIN produtos p ON p.idproduto = v.codproduto
        LEFT JOIN multi_preco m ON m.idproduto = v.codproduto AND m.idempresa = v.idempresa
       WHERE v.dtvenda >= ${ini}::timestamptz AND v.dtvenda <= ${fim}::timestamptz
         AND v.idempresa IN (${sql.join(empresas)})
         AND v.codproduto IN (${sql.join(produtos)}) AND v.cancelado = 'N'
         AND v.promocao = 'S'
       GROUP BY v.promocao${itens ? sql`, p.codbarra, p.idproduto, p.descricao ORDER BY p.descricao` : sql``}`.execute(db)).rows;
    return rows.map((r) => {
      const total = r2(num(r.vr_total_venda));
      const difV = r2(num(r.vr_total_dif_venda_promo));
      return { ...r, vr_total_venda: total, qtde: num(r.qtde), vr_total_dif_venda_promo: difV, vr_total_venda_promo: r2(total - difV), vr_total_perc_dif_venda_promo: total !== 0 ? r2((difV / total) * 100) : null };
    });
  }

  /**
   * `GetSQL(22)` ProdutosVendidosPorEmpresa (uVendas.pas:3311): a venda em promoção por loja × produto. O legado pivota
   * até 3 lojas (campos Q1..Q3/C1..C3/V1..V3, indexados pelo CÓDIGO da loja — com loja 4 ele quebraria) e, acima disso,
   * imprime a lista; aqui vão a lista e o pivô por loja, para qualquer número de lojas.
   */
  private async porLoja(db: AnyDB, ini: string, fim: string, empresas: number[], produtos: number[]) {
    if (!produtos.length) return { linhas: [], porProduto: [] };
    const rows = (await sql<Record<string, unknown>>`
      SELECT p.codbarra, sum(v.qtde) AS qtde, p.descricao, v.codproduto, p.unidade, v.idempresa,
             sum(${this.bruto(sql`v.qtde * v.vrvenda`)}) AS vrvenda,
             sum(round((v.qtde * v.vrcusto)::numeric, 2)) AS vrcusto
        FROM vendas v
        LEFT JOIN produtos p ON p.idproduto = v.codproduto
       WHERE v.dtvenda >= ${ini}::timestamptz AND v.dtvenda <= ${fim}::timestamptz
         AND v.idempresa IN (${sql.join(empresas)})
         AND v.codproduto IN (${sql.join(produtos)}) AND v.cancelado = 'N'
         AND coalesce(v.promocao, 'N') = 'S'
       GROUP BY v.idempresa, v.codproduto, p.codbarra, p.descricao, p.unidade
       ORDER BY p.descricao, v.codproduto, v.idempresa`.execute(db)).rows;
    const linhas = rows.map((r) => ({ ...r, qtde: num(r.qtde), vrvenda: r2(num(r.vrvenda)), vrcusto: r2(num(r.vrcusto)) })) as Array<Record<string, unknown> & { qtde: number; vrvenda: number; vrcusto: number }>;
    const porProduto: Array<{ codproduto: number; codbarra: unknown; descricao: unknown; lojas: Record<string, { qtde: number; vrcusto: number; vrvenda: number }> }> = [];
    for (const l of linhas) {
      let p = porProduto[porProduto.length - 1];
      if (!p || p.codproduto !== Number(l.codproduto)) porProduto.push((p = { codproduto: Number(l.codproduto), codbarra: l.codbarra, descricao: l.descricao, lojas: {} }));
      p.lojas[String(l.idempresa)] = { qtde: l.qtde, vrcusto: l.vrcusto, vrvenda: l.vrvenda };
    }
    return { linhas, porProduto };
  }

  /**
   * os itens com o preço da loja — "fim da promoção" (sqqRelFimPromocao, udmCadAgendaPromocao.dfm) e "produtos inativos"
   * (MontarDataSetProdInativos, uCadAgendaPromocao.pas:2518). Só agenda A/E/N (as FECHADAS não entram). PRECO2 = o
   * preço 2 do produto (desconto D = somado, P = percentual). ⚠️ Desvio consciente: o legado não filtra a agenda EXCLUÍDA
   * (INDR='E'), e na produção há uma aberta que termina em 28/09/2026 — ela sairia no "fim da promoção" com preços que
   * nunca valeram. Aqui a excluída fica de fora.
   */
  private async itensComPreco(db: AnyDB, emp: number, o: { codagenda?: number; inativos?: boolean; fimEm?: string }) {
    const desc2 = sql`coalesce(m.vrdescpreco2, coalesce(z.vrdescpreco2, 0))`;
    let q = db.selectFrom('agenda_promocao_itens as x')
      .leftJoin('produtos as z', 'z.idproduto', 'x.idproduto')
      .innerJoin('multi_preco as m', (j) => j.onRef('m.idproduto', '=', 'x.idproduto').on('m.idempresa', '=', emp))
      .leftJoin('familias_prod as f', (j) => j.onRef('f.codfamilia', '=', 'z.codgrupopreco').on('f.tipo', '=', 'P'))
      .leftJoin('familias_prod as d', (j) => j.onRef('d.codfamilia', '=', 'z.coddpto').on('d.tipo', '=', 'D'))
      .innerJoin('agenda_promocao as a', 'a.codagenda', 'x.codagenda')
      .select(['x.codagendaitem', 'x.codagenda', 'z.codbarra', 'z.descricao', 'm.vrvenda', 'm.vrpromo', 'x.vlrpromocao', 'x.idproduto', 'x.empresas',
        'z.codgrupopreco', 'x.atualizacao_grupo', sql`f.descricao`.as('desc_grupo'), 'z.coddpto', sql`d.descricao`.as('depto'), 'z.unidade',
        sql`${desc2}`.as('vrdescpreco2'),
        sql`case when ${desc2} <> 0 then case when z.tpdescpreco2 = 'D' then m.vrvenda + ${desc2}
                                          when z.tpdescpreco2 = 'P' then m.vrvenda + (m.vrvenda * ${desc2} / 100) else 0 end else 0 end`.as('preco2'),
        'x.ativo', 'x.tv', 'x.radio', 'x.tabloide', 'x.interno', 'x.opcoes'])
      .where('a.flagpromocao', 'in', ['A', 'E', 'N'])
      .where(sql`coalesce(a.indr, 'I')`, '<>', 'E');
    if (o.codagenda != null) q = q.where('x.codagenda', '=', o.codagenda);
    if (o.inativos) q = q.where('x.ativo', '=', 'N');
    if (o.fimEm) q = q.where(sql`(a.dtfimpromocao AT TIME ZONE 'America/Sao_Paulo')::date`, '=', sql`${o.fimEm}::date`).where('a.idempresa', '=', emp);
    const rows = (await q.orderBy('x.codagenda').orderBy(sql`d.descricao`).orderBy('z.descricao').execute()) as Record<string, unknown>[];
    return rows.map((r) => ({ ...r, preco2: r2(num(r.preco2)) }));
  }
}
