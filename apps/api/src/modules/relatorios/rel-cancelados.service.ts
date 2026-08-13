import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroCancelados {
  dtini: string; dtfim: string;
  horaIni?: string; horaFim?: string; filtrarHora?: boolean;
}

/**
 * CANCELAMENTOS (rel 28 ×3 variações + rel 30) e DESCONTOS DE OPERADOR (rel 32 ×2) — as variantes do hub que
 * cruzam VENDAS com o log HISTORICO_PDV para descobrir QUEM AUTORIZOU.
 *
 * O MECANISMO COMUM (e suas duas versões, que NÃO são iguais):
 *  · CANCELADOS: o responsável vem do ÚLTIMO evento do PEDIDO cujo texto contém 'CANCELAMENTO' e NÃO contém
 *    'ABERTA:' (o MAX(IDHISTORICO) é filtrado pelo texto de H2). Sem evento ⇒ cai no nome do OPERADOR.
 *  · DESCONTOS: ⚠️ o filtro de texto é sobre **H, não H2** (`INSTRC(UPPER(H.HISTORICO),'DESCONTO')` dentro do
 *    subselect de H2) — ou seja: pega-se o ÚLTIMO evento DO CUPOM (qualquer texto) e ele só vale se ELE MESMO
 *    for de desconto; senão NULL ⇒ operador. Não é o "último evento de desconto" — é "o último evento, se for
 *    de desconto". Quirk do legado, copiado. E os eventos são limitados AO PERÍODO (o legado materializa
 *    HISTORICO_TEMP, um CTE de HISTORICO_PDV recortado pelas datas — a "tabela" que não existe no Oracle).
 *
 * POR VARIANTE:
 *  · 28-0 resumo: 2 níveis de GROUP BY — o de baixo por CUPOM, o de cima por (operador, responsável,
 *    histórico, motivo) com COUNT(1) = nº de CUPONS (contagem de grupos, lição 32). CANCELADO='S' +
 *    NROCUPOM IS NOT NULL. RESPONSAVEL nulo vira ' ' (o COALESCE com CAST(' ') do legado).
 *  · 28-1 por operador com itens: TOTAL_VENDA_LIQUIDO = bruto + acréscimo − (outros_descontos +
 *    desc_acre_medio), onde OUTROS_DESCONTOS junta promoção+departamento+item<0 e o DESC_ACRE_MEDIO<0 sai
 *    positivado em coluna própria. `CODVENDEDOR = 1` (o consumidor-padrão) vira 0 e o nome vira o do
 *    OPERADOR. TOTAL_DESCONTO_RESPONSAVEL é literal 0 no fonte (morto).
 *  · 28-2 por data com itens: igual à 28-1 sem a troca de vendedor, com a HORA em texto.
 *  · 30 por fiscal: TIPOCANC='C' + CANCELADO='S' + RESPONSAVEL IS NOT NULL; o responsável vem por JOIN
 *    (não subselect): HISTORICO_PDV por NROCUPOM + CODPDV = os 2 PRIMEIROS CHARS do NROPEDIDO + texto
 *    'CANCELAMENTO DE CUPOM'. A medida é `SUM(fórmula TRUNCADA sem IAT) + AVG(DESC_ACRE)` — o AVG é do
 *    legado (média do desconto por linha do cupom, somada ao total), e o COUNT(1) externo conta CUPONS.
 *  · 32-0 resumo de descontos: SÓ linhas com desconto de OPERADOR (item<0 OU medio<0), CANCELADO='N'
 *    hardcoded; o nível interno agrupa por (operador, cupom, **V.DESC_PROMOCAO cru**) — o valor cru na chave
 *    divide o cupom, e o COUNT(1) externo conta esses GRUPOS, não cupons distintos. Copiado.
 *  · 32-1 descontos com itens: mesma elegibilidade, detalhe por produto.
 *
 * ⚠️ AS DATAS DAS 28-1/28-2/32-x TÊM A LÓGICA DO FILTRO DE HORA INVERTIDA no legado (o `if FTipoFiltro` usa
 * janela contínua no ramo que as outras usam trunc) — na prática o form manda FTipoFiltro=false na trilha
 * Vendas, que nessas variantes é a janela dtini+hora→dtfim+hora igual às demais. Portado pelo caminho vivo.
 */
@Injectable()
export class RelCanceladosService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async ctx(f: FiltroCancelados) {
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
    const acresc = sql`greatest(coalesce(v.desc_acre_medio,0),0) + greatest(coalesce(v.desc_acre_item,0),0)`;
    const desc = sql`coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
      + abs(least(coalesce(v.desc_acre_medio,0),0)) + abs(least(coalesce(v.desc_acre_item,0),0))`;
    // 28-1/28-2: promoção+departamento+item<0 (SEM o medio, que sai em coluna própria)
    const outrosDesc = sql`coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
      + abs(least(coalesce(v.desc_acre_item,0),0))`;
    const medioPos = sql`abs(least(coalesce(v.desc_acre_medio,0),0))`;
    return { bruto, acresc, desc, outrosDesc, medioPos };
  }

  /** o subselect do responsável/histórico/motivo do ÚLTIMO evento de CANCELAMENTO do PEDIDO. */
  private evCancel(campo: 'responsavel' | 'historico' | 'motivo') {
    return sql`(select h.${sql.raw(campo)} from historico_pdv h
      where h.nropedido = v.nropedido and h.idempresa = v.idempresa
        and h.idhistorico in (select max(h2.idhistorico) from historico_pdv h2
          where h2.nropedido = h.nropedido and h2.idempresa = h.idempresa
            and upper(h2.historico) like '%CANCELAMENTO%'
            and upper(h2.historico) not like '%ABERTA:%'))`;
  }

  private periodo<Q extends { where: (...a: any[]) => Q }>(q: Q, f: FiltroCancelados, tz: string, ate: string): Q {
    if (f.filtrarHora && f.horaIni && f.horaFim) {
      return q.where('v.dtvenda', '>=', sql`(${`${f.dtini} ${f.horaIni}`}::timestamp at time zone ${tz})`)
        .where('v.dtvenda', '<=', sql`(${`${f.dtfim} ${f.horaFim}`}::timestamp at time zone ${tz})`);
    }
    return q.where('v.dtvenda', '>=', sql`(${f.dtini}::timestamp at time zone ${tz})`)
      .where('v.dtvenda', '<', sql`(${ate}::timestamp at time zone ${tz})`);
  }

  /** rel 28 var 0 — resumo dos cancelamentos por operador × responsável. */
  async resumo(f: FiltroCancelados) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { bruto, acresc, desc } = this.forms();
    // nível do CUPOM
    let cupom = db.selectFrom('vendas as v')
      .leftJoin('operadores as o', 'o.codoperador', 'v.operador')
      .select([
        'o.codoperador', sql`o.nome`.as('nome'),
        sql`coalesce(${this.evCancel('responsavel')}, o.nome)`.as('responsavel'),
        sql`${this.evCancel('historico')}`.as('historico'),
        sql`${this.evCancel('motivo')}`.as('motivo'),
        sql`to_char(v.dtvenda at time zone ${tz}, 'YYYY-MM-DD')`.as('dia'),
        'v.nrocupom',
        sql`sum(${bruto}) + sum(${acresc}) - sum(${desc})`.as('total_venda'),
      ])
      .where('v.idempresa', '=', emp)
      .where(sql<boolean>`coalesce(v.cancelado,'N') = 'S'`)
      .where(sql<boolean>`v.nrocupom is not null`);
    cupom = this.periodo(cupom, f, tz, ate)
      .groupBy(['o.codoperador', sql`o.nome`, sql`3`, sql`4`, sql`5`, sql`6`, 'v.nrocupom', 'v.nropedido']);
    // nível de cima: COUNT(1) = contagem de GRUPOS-cupom
    const rows = (await db.selectFrom(cupom.as('c')).select([
      'c.codoperador', 'c.nome',
      sql`coalesce(c.responsavel, ' ')`.as('responsavel'),
      'c.historico', 'c.motivo',
      sql`max(c.dia)`.as('data'),
      sql`round(sum(c.total_venda)::numeric, 2)`.as('total_venda'),
      sql`count(1)`.as('nrocupons'),
    ]).groupBy(['c.codoperador', 'c.nome', sql`3`, 'c.historico', 'c.motivo'])
      .orderBy('c.nome').execute()) as Record<string, unknown>[];
    const linhas = rows.map((r) => ({ ...r, total_venda: r2(num(r.total_venda)), nrocupons: Number(r.nrocupons ?? 0) }));
    return {
      linhas,
      totais: {
        total_venda: r2(linhas.reduce((s, l) => s + num(l.total_venda), 0)),
        cupons: linhas.reduce((s, l) => s + Number(l.nrocupons ?? 0), 0),
      },
      filtro: { ...f, empresa: emp, fuso: tz },
    };
  }

  /** rel 28 var 1/2 — cancelados COM ITENS (por operador ou por data). */
  async comItens(f: FiltroCancelados, porData: boolean) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { bruto, acresc, outrosDesc, medioPos } = this.forms();
    let q = db.selectFrom('vendas as v')
      .leftJoin('operadores as o', 'o.codoperador', 'v.operador')
      .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
      .leftJoin('parceiros as ve', 've.codparceiro', 'v.codvendedor')
      .select([
        sql`coalesce(${this.evCancel('responsavel')}, o.nome)`.as('responsavel'),
        'o.codoperador', sql`o.nome`.as('operadora'),
        'v.nrocupom',
        sql`to_char(v.dtvenda at time zone ${tz}, 'YYYY-MM-DD')`.as('dtvenda'),
        ...(porData ? [sql`to_char(v.dtvenda at time zone ${tz}, 'HH24:MI:SS')`.as('hora')] : []),
        'v.codproduto', 'p.codbarra', sql`p.descricao`.as('descricao'),
        // 28-1: o vendedor 1 (consumidor-padrão) vira 0 e o nome vira o do operador — fiel ao CASE do legado
        ...(!porData ? [
          sql`case when v.codvendedor = 1 then 0 else v.codvendedor end`.as('codvendedor'),
          sql`case when v.codvendedor = 1 then o.nome else ve.razao end`.as('razao'),
        ] : []),
        sql`round(sum(coalesce(v.qtde,0))::numeric, 3)`.as('qtde'),
        sql`round(sum(${bruto})::numeric, 2)`.as('total_venda_bruto'),
        sql`round((sum(${bruto}) + sum(${acresc}) - (sum(${outrosDesc}) + sum(${medioPos})))::numeric, 2)`.as('total_venda_liquido'),
        sql`round(sum(${acresc})::numeric, 2)`.as('acrescimo'),
        sql`round(sum(${outrosDesc})::numeric, 2)`.as('outros_descontos'),
        sql`round(sum(${medioPos})::numeric, 2)`.as('desc_acre_medio'),
      ])
      .where('v.idempresa', '=', emp)
      .where(sql<boolean>`coalesce(v.cancelado,'N') = 'S'`);
    q = this.periodo(q, f, tz, ate);
    // v.idempresa entra no GROUP BY (como no legado) — é o que permite a subquery correlacionada do responsável
    const grupo: any[] = ['v.idempresa', 'o.codoperador', sql`o.nome`, 'v.nrocupom', sql`5`, 'v.codproduto', 'p.codbarra', 'p.descricao', 'v.nropedido'];
    if (porData) grupo.push(sql`6`);
    else grupo.push('v.codvendedor', sql`ve.razao`);
    const rows = (await q.groupBy(grupo)
      .orderBy(sql`o.nome`).orderBy('v.nrocupom').limit(20001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 20000;
    const linhas: Record<string, unknown>[] = (truncado ? rows.slice(0, 20000) : rows).map((r) => ({
      ...r, qtde: num(r.qtde),
      total_venda_bruto: r2(num(r.total_venda_bruto)), total_venda_liquido: r2(num(r.total_venda_liquido)),
      acrescimo: r2(num(r.acrescimo)), outros_descontos: r2(num(r.outros_descontos)),
      desc_acre_medio: r2(num(r.desc_acre_medio)),
      total_desconto_responsavel: 0, // literal 0 no fonte — coluna morta do leiaute
    }));
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        total_bruto: r2(linhas.reduce((s, l) => s + num(l.total_venda_bruto), 0)),
        total_liquido: r2(linhas.reduce((s, l) => s + num(l.total_venda_liquido), 0)),
        cupons: new Set(linhas.map((l) => `${l.nrocupom}`)).size,
      },
      filtro: { ...f, empresa: emp, fuso: tz, truncado, max_linhas: 20000 },
    };
  }

  /** rel 30 — cancelados por FISCAL (responsável), só cupom inteiro (TIPOCANC='C'). */
  async porFiscal(f: FiltroCancelados) {
    const { emp, tz, ate, db } = await this.ctx(f);
    // fórmula TRUNCADA sem IAT + AVG(desc_acre) — é o que o legado soma aqui (quirk preservado)
    let cupom = db.selectFrom('vendas as v')
      .innerJoin('historico_pdv as h', (j) => j.on(sql<boolean>`h.nrocupom = v.nrocupom
        and h.codpdv = (case when substring(coalesce(v.nropedido,'') from 1 for 2) ~ '^[0-9]+$'
                        then substring(v.nropedido from 1 for 2)::int end)
        and upper(h.historico) like '%CANCELAMENTO DE CUPOM%'`))
      .select([
        sql`h.responsavel`.as('responsavel'),
        'v.nrocupom',
        sql`round((sum(trunc((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric * 100) / 100)
          + coalesce(avg(coalesce(v.desc_acre,0)),0))::numeric, 2)`.as('total_venda'),
      ])
      .where('v.idempresa', '=', emp)
      .where(sql<boolean>`coalesce(v.cancelado,'N') = 'S'`)
      .where(sql<boolean>`v.tipocanc = 'C'`)
      .where(sql<boolean>`h.responsavel is not null`);
    cupom = this.periodo(cupom, f, tz, ate).groupBy([sql`h.responsavel`, 'v.nrocupom']);
    const rows = (await db.selectFrom(cupom.as('c')).select([
      'c.responsavel',
      sql`round(sum(c.total_venda)::numeric, 2)`.as('total_venda'),
      sql`count(1)`.as('nrocupons'),
    ]).groupBy('c.responsavel').orderBy('c.responsavel').execute()) as Record<string, unknown>[];
    const linhas = rows.map((r) => ({ ...r, total_venda: r2(num(r.total_venda)), nrocupons: Number(r.nrocupons ?? 0) }));
    return {
      linhas,
      totais: {
        total_venda: r2(linhas.reduce((s, l) => s + num(l.total_venda), 0)),
        cupons: linhas.reduce((s, l) => s + Number(l.nrocupons ?? 0), 0),
      },
      filtro: { ...f, empresa: emp, fuso: tz },
    };
  }

  /** o subselect do responsável de DESCONTO — o quirk do filtro em H (ver cabeçalho), com o recorte de período. */
  private evDesconto(f: FiltroCancelados, tz: string, ate: string) {
    return sql`(select h.responsavel from historico_pdv h
      where h.nrocupom = v.nrocupom and h.idempresa = v.idempresa
        and h.data >= (${f.dtini}::timestamp at time zone ${tz}) and h.data < (${ate}::timestamp at time zone ${tz})
        and h.idhistorico in (select max(h2.idhistorico) from historico_pdv h2
          where h2.nrocupom = h.nrocupom and h2.idempresa = h.idempresa
            and h2.data >= (${f.dtini}::timestamp at time zone ${tz}) and h2.data < (${ate}::timestamp at time zone ${tz})
            and upper(h.historico) like '%DESCONTO%'))`;
  }

  /** rel 32 var 0 — resumo dos descontos de operador por responsável. */
  async descontosResumo(f: FiltroCancelados) {
    const { emp, tz, ate, db } = await this.ctx(f);
    let grupoInterno = db.selectFrom('vendas as v')
      .leftJoin('operadores as o', 'o.codoperador', 'v.operador')
      .select([
        sql`coalesce(${this.evDesconto(f, tz, ate)}, o.nome)`.as('responsavel'),
        sql`o.nome`.as('operadora'),
        'v.nrocupom',
        sql`sum(coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
          + abs(least(coalesce(v.desc_acre_medio,0),0)) + abs(least(coalesce(v.desc_acre_item,0),0)))`.as('desc_total'),
        sql`max(to_char(v.dtvenda at time zone ${tz}, 'YYYY-MM-DD'))`.as('ultimo_data_desconto'),
        sql`sum(coalesce(v.desc_promocao,0))`.as('descprom'),
        sql`sum(abs(least(coalesce(v.desc_acre_medio,0),0)) + abs(least(coalesce(v.desc_acre_item,0),0)))`.as('desc_total_opera'),
        sql`sum(coalesce(v.desc_promocao,0)
          + abs(least(coalesce(v.desc_acre_medio,0),0)) + abs(least(coalesce(v.desc_acre_item,0),0)))`.as('desc_total_semdpto'),
      ])
      .where('v.idempresa', '=', emp)
      .where(sql<boolean>`coalesce(v.cancelado,'N') = 'N'`)
      // SÓ desconto de OPERADOR: item<0 OU medio<0 (elegibilidade do legado)
      .where(sql<boolean>`(coalesce(v.desc_acre_item,0) < 0 or coalesce(v.desc_acre_medio,0) < 0)`);
    grupoInterno = this.periodo(grupoInterno, f, tz, ate)
      // ⚠️ V.DESC_PROMOCAO CRU na chave — divide o cupom por valor de desconto; o COUNT de cima conta GRUPOS
      .groupBy([sql`1`, sql`o.nome`, 'v.nrocupom', 'v.desc_promocao']);
    const rows = (await db.selectFrom(grupoInterno.as('g')).select([
      'g.responsavel', 'g.operadora',
      sql`round(sum(g.desc_total)::numeric, 2)`.as('total_desconto_venda'),
      sql`count(1)`.as('nrocupons'),
      sql`max(g.ultimo_data_desconto)`.as('ultimo_data_desconto'),
      sql`round(sum(g.descprom)::numeric, 2)`.as('descprom'),
      sql`round(sum(g.desc_total_opera)::numeric, 2)`.as('desc_total_opera'),
      sql`round(sum(g.desc_total_semdpto)::numeric, 2)`.as('desc_total_semdpto'),
    ]).groupBy(['g.responsavel', 'g.operadora'])
      .orderBy('g.responsavel').orderBy('g.operadora').execute()) as Record<string, unknown>[];
    const linhas = rows.map((r) => ({
      ...r, total_desconto_venda: r2(num(r.total_desconto_venda)), nrocupons: Number(r.nrocupons ?? 0),
      descprom: r2(num(r.descprom)), desc_total_opera: r2(num(r.desc_total_opera)), desc_total_semdpto: r2(num(r.desc_total_semdpto)),
    }));
    return {
      linhas,
      totais: {
        total_desconto: r2(linhas.reduce((s, l) => s + num(l.total_desconto_venda), 0)),
        grupos: linhas.reduce((s, l) => s + Number(l.nrocupons ?? 0), 0),
      },
      filtro: { ...f, empresa: emp, fuso: tz },
    };
  }

  /** rel 32 var 1 — descontos com itens. */
  async descontosItens(f: FiltroCancelados) {
    const { emp, tz, ate, db } = await this.ctx(f);
    const { bruto, acresc, desc } = this.forms();
    let q = db.selectFrom('vendas as v')
      .leftJoin('operadores as o', 'o.codoperador', 'v.operador')
      .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
      .select([
        sql`coalesce(${this.evDesconto(f, tz, ate)}, o.nome)`.as('responsavel'),
        sql`o.nome`.as('operadora'),
        'v.nrocupom',
        sql`to_char(v.dtvenda at time zone ${tz}, 'YYYY-MM-DD')`.as('dtvenda'),
        'v.codproduto', 'p.codbarra', sql`p.descricao`.as('descricao'),
        sql`round(sum(coalesce(v.qtde,0))::numeric, 3)`.as('qtde'),
        sql`round(sum(${bruto})::numeric, 2)`.as('total_venda_bruto'),
        sql`round((sum(${bruto}) + sum(${acresc}) - sum(${desc}))::numeric, 2)`.as('total_venda_liquido'),
        sql`round(sum(${acresc})::numeric, 2)`.as('acrescimo'),
        sql`round(sum(${desc})::numeric, 2)`.as('desc_promocao'),
      ])
      .where('v.idempresa', '=', emp)
      .where(sql<boolean>`coalesce(v.cancelado,'N') = 'N'`)
      .where(sql<boolean>`(coalesce(v.desc_acre_item,0) < 0 or coalesce(v.desc_acre_medio,0) < 0)`);
    q = this.periodo(q, f, tz, ate)
      .groupBy([sql`1`, sql`o.nome`, 'v.nrocupom', sql`4`, 'v.codproduto', 'p.codbarra', 'p.descricao']);
    const rows = (await q.orderBy(sql`1`).orderBy(sql`o.nome`).orderBy(sql`4`).orderBy('v.nrocupom')
      .limit(20001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 20000;
    const linhas = (truncado ? rows.slice(0, 20000) : rows).map((r) => ({
      ...r, qtde: num(r.qtde), total_venda_bruto: r2(num(r.total_venda_bruto)),
      total_venda_liquido: r2(num(r.total_venda_liquido)), acrescimo: r2(num(r.acrescimo)),
      desc_promocao: r2(num(r.desc_promocao)), total_desconto_responsavel: 0,
    }));
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        total_desconto: r2(linhas.reduce((s, l) => s + num(l.desc_promocao), 0)),
      },
      filtro: { ...f, empresa: emp, fuso: tz, truncado, max_linhas: 20000 },
    };
  }
}
