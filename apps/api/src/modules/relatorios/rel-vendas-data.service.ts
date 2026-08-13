import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroVendasData {
  dtini: string; dtfim: string;
  horaIni?: string; horaFim?: string; filtrarHora?: boolean;
  canceladas?: 'N' | 'S' | 'T';
  promocao?: 'S' | 'N' | 'T';
  produto?: string; fornecedor?: string;
  departamentos?: number[]; grupos?: number[]; subgrupos?: number[]; secoes?: number[];
  aliquota?: string;
}

/**
 * VENDAS DATA — rel 02 do hub FRMRELVENDAS (`uVendas.pas` `TVendas.Rel02_VendasData`, GetSQL case 02). O
 * fechamento DIÁRIO: uma linha por dia com venda, custo, lucro, ticket médio e nº de cupons. É a 2ª opção do
 * combo e a visão que o app não tinha (Finalizadoras dá dia × forma de pagamento; esta dá o resultado do dia).
 *
 * TRÊS NÍVEIS no legado, e o do meio é OBRIGATÓRIO:
 *   L1 agrupa por (empresa, dia, nropedido, nrocupom, **CODVENDAS**, iat, qtde, vrvenda, vrcusto, os 4 descontos)
 *      — `CODVENDAS` é a PK de VENDAS, então L1 é 1 linha por ITEM e os SUMs dele são no-ops. Colapsa.
 *   L2 agrupa por (empresa, dia, nropedido, nrocupom) = **o CUPOM**. Aqui nasce o arredondamento
 *      (`CAST(... AS NUMERIC(18,2))` sobre a soma do cupom) e é o nível que o de cima CONTA.
 *   L3 agrupa por (empresa, dia) e faz `COUNT(CUPONS)` — **contagem de GRUPOS de L2**, não soma. Por isso os
 *      dois níveis NÃO colapsam (lição 32): sem L2 não existe "nº de cupons do dia" nem ticket médio.
 *
 * ⚠️ `CUPONS` em L2 **não é 1**: é `COUNT(NROCUPOM)` sobre as linhas de L1, ou seja **o nº de ITENS do cupom**.
 * Só serve como um valor não-nulo p/ o `COUNT(CUPONS)` de L3 contar. O `VR_TICKET_MEDIO` de L2 (total do cupom ÷
 * itens do cupom) é intermediário e é RECALCULADO em L3 como total do dia ÷ nº de cupons — este é o exibido.
 *
 * ⚠️ `LUCRO_B_PERCENT` É A FÓRMULA QUEBRADA DO LEGADO, e é ela que a grade mostra na coluna «RENT/MARKDOWN»
 * (uRelVendasGrid2.dfm): `-(SUM(TOTAL_CUSTO) / (SUM(TOTAL_VENDA) − 1)) × 100`. O `−1` está FORA do parêntese
 * errado — a intenção era `(custo/venda − 1) × 100 × −1`, e o que roda é "custo dividido pela venda MENOS UM
 * REAL". Dá um número negativo próximo do markdown, mas não é ele. Portada como está (é o número que reconcilia
 * com o relatório de hoje) e, ao lado, `rentabilidade` — o campo que a MESMA query calcula corretamente e a
 * grade NÃO exibe. O rodapé do legado (`FooterSummaryValues[3]`, uRelVendasGrid2.pas:331) usa a fórmula CERTA,
 * então na tela original a linha e o rodapé não fecham entre si. Reproduzido: é diagnóstico, não enfeite.
 *
 * ⚠️ RAZÕES CAEM P/ **0**, não NULL: aqui o legado escreve `CASE WHEN SUM(x) = 0 THEN 0 ELSE ... END`
 * explicitamente (ao contrário da rel 01, cuja grade divide por NULLIF e mostra branco). Fidelidade é por
 * relatório, não por app.
 *
 * NÃO PORTADO — `TOTAL_VENDA_PERCENT` (participação do dia), coluna que existe na grade: ela divide pelo total
 * da SUBCONSULTA (`GetTotalVendaPorData`, uRelVendasGrid2.pas:347) e **não há subconsulta registrada para a
 * variante 02** em `GetSQLSubConsulta` (só 07/16/38/49) — o helper devolve 0 e a divisão não tem fonte.
 * Cópia-fiel-negativa: a coluna não produz valor no legado, então não inventamos um.
 *
 * `AND CANCELADO = 'N'` está **comentado** no fonte (:linha do `//`): o recorte de cancelados vem do frame
 * (rgCanceladas, default "não canceladas") via FFiltro, igual às outras variantes.
 */
@Injectable()
export class RelVendasDataService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(f: FiltroVendasData): Promise<{
    linhas: Record<string, unknown>[];
    totais: Record<string, unknown>;
    filtro: Record<string, unknown>;
  }> {
    const emp = this.emp();
    if (!f.dtini || !f.dtfim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    if (String(f.dtini) > String(f.dtfim)) throw new BusinessRuleError('PERIODO_INVERTIDO', { dtini: f.dtini, dtfim: f.dtfim });
    const db = this.dbp.forTenantRead() as AnyDB;
    // `TRUNC(V.DTVENDA)` do legado resolve no fuso da SESSÃO; com o processo em UTC a venda de 21h-23h59 cai no
    // DIA SEGUINTE (4,02% das linhas do golden). O balde e os DOIS limites usam o fuso da config.
    const tz = String((await this.config.resolver('FUSO_HORARIO_ACESSO', { empresaId: emp })) ?? 'America/Sao_Paulo');
    const fimExcl = new Date(`${f.dtfim}T00:00:00Z`);
    if (Number.isNaN(fimExcl.getTime())) throw new BusinessRuleError('PERIODO_INVALIDO', { dtfim: f.dtfim });
    fimExcl.setUTCDate(fimExcl.getUTCDate() + 1);
    const ate = fimExcl.toISOString().slice(0, 10);

    // fórmulas por ITEM — as mesmas da rel 01/09 (VALOR_VENDA_IAT + as duas metades assinadas)
    const bruto = sql`case when coalesce(v.iat,'') = 'A'
      then round((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric, 2)
      else trunc((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric * 100) / 100 end`;
    const acresc = sql`greatest(coalesce(v.desc_acre_medio,0),0) + greatest(coalesce(v.desc_acre_item,0),0)`;
    const desc = sql`coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
      + abs(least(coalesce(v.desc_acre_medio,0),0)) + abs(least(coalesce(v.desc_acre_item,0),0))`;
    const custoItem = sql`round((coalesce(v.qtde,0) * coalesce(v.vrcusto,0))::numeric, 2)`;

    // ---- L2: o CUPOM (onde nasce o arredondamento e o que L3 vai CONTAR) ----
    let cupom = db
      .selectFrom('vendas as v')
      .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
      .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
      .select([
        'v.idempresa',
        sql`to_char(v.dtvenda at time zone ${tz}, 'YYYY-MM-DD')`.as('dia'),
        'v.nropedido', 'v.nrocupom',
        sql`round((sum(${bruto}) + sum(${acresc}) - sum(${desc}))::numeric, 2)`.as('total_venda'),
        sql`round(sum(${custoItem})::numeric, 2)`.as('total_custo'),
        sql`round((sum(${bruto}) + sum(${acresc}) - sum(${desc}) - sum(${custoItem}))::numeric, 2)`.as('total_lucro'),
        sql`sum(coalesce(v.qtde,0))`.as('qtde'),
        // fiel: é a contagem de ITENS do cupom, e serve só p/ o COUNT de L3 ter o que contar
        sql`count(v.nrocupom)`.as('itens'),
      ])
      .where('v.idempresa', '=', emp);

    // período: com «Filtrar Hora» é UMA JANELA CONTÍNUA (o legado usa FDtime1/FDtime2, :linha do BETWEEN com
    // data+hora); sem ela são os dias inteiros. Sempre na coluna CRUA (`::date` invalidaria ix_vendas_empresa_data).
    if (f.filtrarHora && f.horaIni && f.horaFim) {
      cupom = cupom.where('v.dtvenda', '>=', sql`(${`${f.dtini} ${f.horaIni}`}::timestamp at time zone ${tz})`)
        .where('v.dtvenda', '<=', sql`(${`${f.dtfim} ${f.horaFim}`}::timestamp at time zone ${tz})`);
    } else {
      cupom = cupom.where('v.dtvenda', '>=', sql`(${f.dtini}::timestamp at time zone ${tz})`)
        .where('v.dtvenda', '<', sql`(${ate}::timestamp at time zone ${tz})`);
    }
    const canc = f.canceladas ?? 'N';
    if (canc === 'N') cupom = cupom.where(sql<boolean>`coalesce(v.cancelado,'N') = 'N'`);
    else if (canc === 'S') cupom = cupom.where(sql<boolean>`coalesce(v.cancelado,'N') = 'S'`);
    if (f.promocao === 'S') cupom = cupom.where('v.promocao', '=', 'S');
    if (f.promocao === 'N') cupom = cupom.where('v.promocao', '=', 'N');
    if (f.produto) cupom = cupom.where(sql<boolean>`upper(p.descricao) like ${`%${f.produto.toUpperCase()}%`}`);
    if (f.fornecedor) cupom = cupom.where(sql<boolean>`upper(forn.razao) like ${`%${f.fornecedor.toUpperCase()}%`}`);
    if (f.departamentos?.length) cupom = cupom.where('p.coddpto', 'in', f.departamentos.map(Number));
    if (f.grupos?.length) cupom = cupom.where('p.codgrupo', 'in', f.grupos.map(Number));
    if (f.subgrupos?.length) cupom = cupom.where('p.codsubgrupo', 'in', f.subgrupos.map(Number));
    if (f.secoes?.length) cupom = cupom.where('p.codsecao', 'in', f.secoes.map(Number));
    if (f.aliquota) cupom = cupom.where(sql<boolean>`v.aliquota like ${`%${f.aliquota}%`}`);
    // ⚠️ o balde de dia é uma expressão COM PARÂMETRO (o fuso): repeti-la no GROUP BY faria o PG reclamar
    // "must appear in the GROUP BY" porque os placeholders diferem — daí `groupBy` pelo ORDINAL da coluna.
    cupom = cupom.groupBy(['v.idempresa', sql`2`, 'v.nropedido', 'v.nrocupom']);

    // ---- L3: o DIA. `count(*)` aqui é a CONTAGEM DE CUPONS (grupos de L2) ----
    const dia = db
      .selectFrom(cupom.as('c'))
      .select([
        'c.idempresa', 'c.dia',
        sql`sum(c.total_venda)`.as('total_venda'),
        sql`sum(c.total_custo)`.as('total_custo'),
        sql`sum(c.total_lucro)`.as('total_lucro'),
        sql`count(*)`.as('cupons'),
        sql`round(sum(c.qtde)::numeric, 2)`.as('total_qtde'),
      ])
      .groupBy(['c.idempresa', 'c.dia'])
      .orderBy('c.dia');

    const rows = (await dia.execute()) as Record<string, unknown>[];

    const linhas = rows.map((r) => {
      const venda = r2(num(r.total_venda));
      const custo = r2(num(r.total_custo));
      const cupons = Number(r.cupons ?? 0);
      return {
        idempresa: r.idempresa, dia: r.dia,
        total_qtde: num(r.total_qtde),
        total_venda: venda,
        total_custo: custo,
        total_lucro: r2(num(r.total_lucro)),
        cupons,
        // L3 recalcula: total do DIA ÷ nº de CUPONS (o de L2 era total do cupom ÷ itens, intermediário)
        vr_ticket_medio: cupons > 0 ? r2(venda / cupons) : 0,
        // as duas razões corretas da query — `CASE WHEN SUM(x)=0 THEN 0`, então 0 e não branco (fiel a esta variante)
        rentabilidade: venda === 0 ? 0 : r2(((venda - custo) / venda) * 100),
        margem: custo === 0 ? 0 : r2((venda / custo - 1) * 100),
        // a coluna «RENT/MARKDOWN» que a grade EXIBE — fórmula quebrada do legado (divide por venda − 1).
        // null quando venda = 1,00 exatos: ali o legado dividiria por zero.
        lucro_b_percent: venda - 1 === 0 ? null : r2(-(custo / (venda - 1)) * 100),
      };
    });

    // ---- RODAPÉ: o legado recalcula com a fórmula CERTA (uRelVendasGrid2.pas:331-338), divergindo das linhas ----
    const somar = (k: string) => r2(linhas.reduce((s, l) => s + num((l as Record<string, unknown>)[k]), 0));
    const totalVenda = somar('total_venda');
    const totalCusto = somar('total_custo');
    const totalCupons = linhas.reduce((s, l) => s + Number(l.cupons ?? 0), 0);
    return {
      linhas,
      totais: {
        dias: linhas.length,
        total_qtde: somar('total_qtde'),
        total_venda: totalVenda,
        total_custo: totalCusto,
        total_lucro: somar('total_lucro'),
        cupons: totalCupons,
        ticket_medio: totalCupons > 0 ? r2(totalVenda / totalCupons) : 0,
        rentabilidade: totalVenda > 0 ? r2(((totalVenda - totalCusto) / totalVenda) * 100) : 0,
        margem: totalCusto > 0 ? r2((totalVenda / totalCusto - 1) * 100) : 0,
      },
      filtro: { ...f, empresa: emp, fuso: tz },
    };
  }
}
