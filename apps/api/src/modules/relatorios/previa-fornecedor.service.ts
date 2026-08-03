import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** 15 slots: FDataAnalise−14 .. FDataAnalise, rotulados '1 DIA'..'15 DIA' (fiel a uRelListaPrecosFornecedor:1842-1858). */
const SLOTS = 15;

export interface FiltroPrevia {
  dataAnalise?: string;
  visualizar?: 'VENDAS' | 'ENTRADAS_SAIDAS';
  empresas?: number[];
  codfor?: number; idproduto?: number;
  departamento?: number; grupo?: number; subgrupo?: number; secao?: number; marca?: number;
  ativo?: number;
  somenteComGiro?: boolean;
}

interface Celula { qtde: number; vrcusto: number; vrvenda: number; vrcustorep: number; qtde_ent?: number; vrcusto_ent?: number }

/**
 * Média das médias diárias PULANDO os dias sem valor — é assim que o legado monta a coluna monetária do layout
 * Quinzenal (uRelListaPrecosFornecedor.pas:1676-1682: acumula só onde o valor > 0 e divide pela CONTAGEM desses
 * dias). Dividir pelos 15 slots, ou fazer um AVG sobre tudo, dá número diferente. null quando não houve nenhum.
 */
function mediaDeCelulas(celulas: (Celula | null)[], campo: keyof Celula): number | null {
  const vals = celulas.map((c) => (c ? Number(c[campo] ?? 0) : 0)).filter((v) => v > 0);
  if (!vals.length) return null;
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length + Number.EPSILON) * 10000) / 10000;
}

/**
 * PRÉVIA DO FORNECEDOR / ANÁLISE DE GIRO (FRMRELLISTAPRECOSFORNECEDOR) — corte-1: "15 Dias" × Vendas /
 * Entradas-e-Saídas. Matriz produto × 15 dias: o comprador vê o giro de cada item do fornecedor por dia e decide
 * a compra. Procedência: `uRelListaPrecosFornecedor.pas` — `GetSQL`/`Get` :1765-1830 (a célula), o dispatch de
 * período :1830-1900, e `udmRelListaPrecosFornecedor.pas:261` `GetSQLListaProdutos` (o CONJUNTO DE LINHAS).
 *
 * DUAS QUERIES, COMO O LEGADO — mas 2 round-trips em vez de 16:
 *  (a) LINHAS = PRODUTOS ⋈ ESTOQUE(empresa) + LEFT parceiros/marcas [+ INNER multi_preco quando há filtro ATIVO].
 *      O legado casa lista×períodos no cliente, então **produto SEM VENDA APARECE COM ZERO** — é o ponto do
 *      relatório (o comprador precisa ver o que NÃO girou). Mantido.
 *  (b) MATRIZ = uma passada agrupando pelo DIA, em vez de 15 queries com `TRUNC(DTVENDA) BETWEEN dia AND dia`.
 *      É EQUIVALENTE: cada slot do legado é um dia isolado e as agregações (SUM/AVG) são por grupo, logo agrupar
 *      por dia sobre a faixa devolve exatamente os mesmos grupos e os mesmos valores. (O mesmo raciocínio que a
 *      auditoria da rel-vendas provou em PG para as duas agregações de lá.)
 *
 * CÉLULA (fiel): SAÍDAS = `vendas` (cancelado='N') UNION ALL NF de saída (proc='S', tipo='S', CFOP em
 * 5102/6102/5402/6402/5403/6403/5405/6405), com `SUM(qtde)`, `AVG(vrcusto)`, `AVG(vrvenda)`, `AVG(vrcustorep)`.
 * Qtde da NF = `quantidade × (fatorembal 0/NULL→1)`. **`CASE WHEN nf_prod.vrvenda=0 THEN vrcusto`** — material,
 * fiel (ver a ressalva de materialidade no próprio ponto). ENTRADAS ('E') só na visualização
 * Entradas-e-Saídas: NF tipo='E' SEM filtro de CFOP, `AVG(CASE WHEN vl_custo=0 THEN vrcusto)`, vrvenda=0.
 *
 * DIVERGÊNCIAS DELIBERADAS (documentadas):
 *  1) `M.VRCUSTOREP` na lista de produtos: o legado só faz o INNER JOIN em MULTI_PRECO quando `FAtivo`, e
 *     `FAtivo := cbbAtivo.Enabled := (Pos(',', Empresa) = 0)` — ou seja o gate é **EMPRESA ÚNICA**, não a escolha
 *     do combo. No fluxo real (1 empresa) o legado SEMPRE inner-joina; em multi-empresa ele seleciona
 *     `M.VRCUSTOREP` sem o join e **o SQL quebraria**. Aqui: LEFT JOIN sempre + gate `is not null` quando há
 *     filtro ATIVO. Impacto medido: ZERO (todas as 43.116 linhas de estoque têm multi_preco correspondente).
 *  2) O `GROUP BY` da lista legada inclui `E.DTENT, E.QTDE_ENT`, então com 2+ empresas o MESMO produto sai em
 *     várias linhas, cada uma com um `SUM(E.QTDE)` parcial. Aqui é 1 linha por produto (agregado). Sob escopo de
 *     empresa única — o caso real do tenant — as duas formas coincidem.
 *  3) `dataAnalise` é parametrizável (default HOJE = fiel a `FDataAnalise := DateOf(Now())`), ver o schema.
 *
 * ADIADO: as outras 7 periodizações (5/30 Dias, 5 Semanas, 5 Meses, 5 Anos, Anual, Por Período — são só outras
 * faixas de data sobre ESTA query) · `tvPedidos` (o `Get` do legado gera SQL idêntico ao de Vendas; a diferença
 * real vive em `MontaSqlPorPeriodo`/`qryPeriodoDiasPedidos`) · o modelo "analítico" (`fdMesesAnalitico`).
 */
@Injectable()
export class PreviaFornecedorService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async matriz(f: FiltroPrevia): Promise<{
    periodos: { slot: number; rotulo: string; dia: string }[];
    linhas: Record<string, unknown>[];
    totais: Record<string, number | null>;
    filtro: Record<string, unknown>;
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const empresas = (f.empresas?.length ? f.empresas.map(Number) : [emp]).filter((e) => e === emp);
    if (!empresas.length) throw new BusinessRuleError('EMPRESA_FORA_DO_ESCOPO', { empresas: f.empresas });

    // FUSO — `dtvenda` é timestamptz e o balde do dia TEM de ser calculado no fuso do negócio, não no do
    // servidor. Com TZ do processo em UTC, toda venda de 21:00-23:59 local cai na coluna do dia SEGUINTE
    // (4,02% das 11,9M linhas do golden; 41% das vendas do tenant são após 17:00). Pior: a venda das 22h do
    // último dia sairia como "sem giro" e o comprador deixaria de repor o item. Mesmo padrão do
    // auth.service (`now() at time zone ${tz}` + config FUSO_HORARIO_ACESSO).
    const tz = String((await this.config.resolver('FUSO_HORARIO_ACESSO', { empresaId: emp })) ?? 'America/Sao_Paulo');
    // âncora: HOJE **no fuso do negócio** por default (fiel a `FDataAnalise := DateOf(Now())`, que é local).
    const hojeLocal = (await sql<{ d: string }>`select to_char(now() at time zone ${tz}, 'YYYY-MM-DD') as d`
      .execute(db)).rows[0].d;
    const ancora = f.dataAnalise ?? hojeLocal;
    const diaDe = (offset: number) => {
      const d = new Date(`${ancora}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) throw new BusinessRuleError('DATA_ANALISE_INVALIDA', { dataAnalise: ancora });
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    // data que passa no regex mas não existe ('2026-02-30') rolaria 2 dias e deslocaria a matriz em silêncio.
    if (diaDe(0) !== ancora) throw new BusinessRuleError('DATA_ANALISE_INVALIDA', { dataAnalise: ancora });
    const periodos = Array.from({ length: SLOTS }, (_, i) => ({
      slot: i + 1, rotulo: `${i + 1} DIA`, dia: diaDe(i - (SLOTS - 1)),
    }));
    const ini = periodos[0].dia;
    const fimExcl = diaDe(1); // faixa [ini, ancora+1) — predicado na coluna CRUA, p/ usar o índice (lição 12c)
    const comEntradas = (f.visualizar ?? 'VENDAS') === 'ENTRADAS_SAIDAS';

    // ---- (a) LINHAS: produtos ⋈ estoque, com os filtros de valor ÚNICO do legado ----
    let qLinhas = db
      .selectFrom('produtos as p')
      .innerJoin('estoque as e', (j) => j.onRef('e.idproduto', '=', 'p.idproduto').on('e.idempresa', 'in', empresas))
      .leftJoin('parceiros as pa', 'pa.codparceiro', 'p.codfor')
      .leftJoin('marcas as ma', 'ma.idmarca', 'p.idmarca')
      // LEFT sempre (o legado só junta quando o filtro ATIVO está ligado, e aí seleciona M.VRCUSTOREP mesmo sem join)
      .leftJoin('multi_preco as m', (j) => j.onRef('m.idproduto', '=', 'e.idproduto').onRef('m.idempresa', '=', 'e.idempresa'))
      .select([
        'p.idproduto', 'p.codbarra', sql`p.descricao`.as('descricao'), 'p.unidade', 'p.fatorcx', 'p.codfor',
        sql`pa.fantasia`.as('fornecedor'),
        sql`coalesce(sum(e.qtde),0)`.as('estoque'),
        sql`coalesce(sum(e.minimo),0)`.as('est_minimo'),
        sql`coalesce(sum(e.maximo),0)`.as('est_maximo'),
        // última entrada: esparsa (12% do golden) → a tela mostra "—", não 0. Data no fuso do negócio (a coluna
        // é timestamptz e 4.750 das 16.716 linhas carregam hora — em UTC a entrada da noite exibia o dia seguinte).
        sql`to_char(max(e.dtent) at time zone ${tz},'YYYY-MM-DD')`.as('dtultent'),
        sql`max(e.qtde_ent)`.as('qtdeultent'),
        sql`max(m.vrcustorep)`.as('vrcustorep_atual'),
      ])
      .where(sql`p.idproduto`, '>', 0) // fiel: WHERE P.IDPRODUTO > 0
      .groupBy(['p.idproduto', 'p.codbarra', 'p.descricao', 'p.unidade', 'p.fatorcx', 'p.codfor', 'pa.fantasia']);

    if (f.codfor != null) qLinhas = qLinhas.where('pa.codparceiro', '=', Number(f.codfor));
    if (f.idproduto != null) qLinhas = qLinhas.where('p.idproduto', '=', Number(f.idproduto));
    if (f.secao != null) qLinhas = qLinhas.where('p.codsecao', '=', Number(f.secao));
    if (f.departamento != null) qLinhas = qLinhas.where('p.coddpto', '=', Number(f.departamento));
    if (f.marca != null) qLinhas = qLinhas.where('ma.idmarca', '=', Number(f.marca));
    if (f.grupo != null) qLinhas = qLinhas.where('p.codgrupo', '=', Number(f.grupo));
    if (f.subgrupo != null) qLinhas = qLinhas.where('p.codsubgrupo', '=', Number(f.subgrupo));
    // filtro ATIVO/ATIVO_COMPRA — os 6 modos de GetFiltroIdxAtivo (o legado usa INNER JOIN; aqui o LEFT já existe
    // e o predicado abaixo elimina o produto sem multi_preco, reproduzindo o efeito do INNER).
    const at = (c: string, v: string) => sql<boolean>`coalesce(m.${sql.raw(c)},'S') = ${v}`;
    if (f.ativo === 1) qLinhas = qLinhas.where(at('ativo_compra', 'S'));
    if (f.ativo === 2) qLinhas = qLinhas.where(at('ativo', 'S'));
    if (f.ativo === 3) qLinhas = qLinhas.where(at('ativo_compra', 'N'));
    if (f.ativo === 4) qLinhas = qLinhas.where(at('ativo', 'N'));
    if (f.ativo === 5) qLinhas = qLinhas.where(at('ativo_compra', 'S')).where(at('ativo', 'S'));
    if (f.ativo === 6) qLinhas = qLinhas.where(at('ativo_compra', 'N')).where(at('ativo', 'N'));
    if (f.ativo != null) qLinhas = qLinhas.where('m.idproduto', 'is not', null); // efeito do INNER JOIN legado

    const MAX_LINHAS = 20000;
    const brutas = (await qLinhas.orderBy(sql`p.descricao`).limit(MAX_LINHAS + 1).execute()) as Record<string, unknown>[];
    const truncado = brutas.length > MAX_LINHAS;
    const rows = truncado ? brutas.slice(0, MAX_LINHAS) : brutas;

    // ---- (b) MATRIZ: SAÍDAS (vendas ∪ NF-saída) [+ ENTRADAS] agrupadas por (dia, produto) ----
    // restringe a matriz aos produtos que a lista já selecionou: sem isso a chamada filtrada por fornecedor
    // continuava agregando o movimento de TODOS os produtos e jogando fora no pivot (desperdício puro).
    const ids = rows.map((r) => Number(r.idproduto));
    const filtrarIds = ids.length > 0 && ids.length <= 5000;
    const CFOP_SAIDA = [5102, 6102, 5402, 6402, 5403, 6403, 5405, 6405];
    // qtde efetiva do item de NF: quantidade × fatorembal, com 0/NULL → 1 (fiel ao CASE do legado)
    const qtdeNf = sql`coalesce(np.quantidade * (case when (np.fatorembal is null or np.fatorembal = 0) then 1 else np.fatorembal end), 0)`;

    const saidasVendas = db.selectFrom('vendas as v')
      .select([
        // dia como TEXTO e **no fuso do negócio** (o driver converte `date` em objeto Date e o pivot casa por
        // string; e o balde em UTC jogaria a venda da noite para o dia seguinte).
        sql`to_char(v.dtvenda at time zone ${tz},'YYYY-MM-DD')`.as('dia'), sql`v.codproduto`.as('codproduto'), sql`'S'`.as('tipo'),
        sql`coalesce(v.qtde,0)`.as('qtde'), sql`coalesce(v.vrcusto,0)`.as('vrcusto'),
        sql`coalesce(v.vrvenda,0)`.as('vrvenda'), sql`coalesce(v.vrcustorep,0)`.as('vrcustorep'),
      ])
      .where(sql`coalesce(v.cancelado,'N')`, '=', 'N')
      .where('v.idempresa', 'in', empresas)
      // limites TAMBÉM no fuso do negócio: meia-noite LOCAL, não UTC (senão o filtro e o balde discordam).
      .where('v.dtvenda', '>=', sql`(${ini}::timestamp at time zone ${tz})`)
      .where('v.dtvenda', '<', sql`(${fimExcl}::timestamp at time zone ${tz})`)
      .$if(filtrarIds, (q) => q.where('v.codproduto', 'in', ids));

    const saidasNf = db.selectFrom('nf as n')
      .innerJoin('nf_prod as np', 'np.codnf', 'n.codnf')
      .select([
        sql`to_char(n.dtcontabil,'YYYY-MM-DD')`.as('dia'), sql`np.codproduto`.as('codproduto'), sql`'S'`.as('tipo'),
        qtdeNf.as('qtde'), sql`coalesce(np.vl_custo,0)`.as('vrcusto'),
        // fiel: VRVENDA=0 cai p/ VRCUSTO. (17,8% das 252.468 linhas de nf_prod têm vrvenda=0, mas só 56 delas
        // sobrevivem ao filtro de CFOP acima — a regra é fiel, a materialidade DELA aqui é pequena.)
        // Divergência consciente: o legado testa `NP.VRVENDA = 0` cru, então VRVENDA **NULL** cai no ELSE e o
        // COALESCE externo devolve 0; aqui `coalesce(vrvenda,0)=0` pega o custo. 365 linhas no golden.
        sql`coalesce(case when coalesce(np.vrvenda,0) = 0 then np.vrcusto else np.vrvenda end, 0)`.as('vrvenda'),
        sql`coalesce(np.vrcustorep,0)`.as('vrcustorep'),
      ])
      .where(sql`coalesce(n.cancelada,'N')`, '=', 'N')
      .where(sql`n.proc`, '=', 'S').where(sql`n.tipo`, '=', 'S')
      .where('n.idempresa', 'in', empresas)
      .where('n.dtcontabil', '>=', sql`${ini}::date`)
      .where('n.dtcontabil', '<', sql`${fimExcl}::date`)
      .where('n.cfop', 'in', CFOP_SAIDA)
      .$if(filtrarIds, (q) => q.where('np.codproduto', 'in', ids));

    let uniao = saidasVendas.unionAll(saidasNf);
    if (comEntradas) {
      // ENTRADAS: NF tipo='E', SEM filtro de CFOP (fiel), custo = CASE vl_custo=0 → vrcusto, venda = 0
      const entradas = db.selectFrom('nf as n')
        .innerJoin('nf_prod as np', 'np.codnf', 'n.codnf')
        .select([
          sql`to_char(n.dtcontabil,'YYYY-MM-DD')`.as('dia'), sql`np.codproduto`.as('codproduto'), sql`'E'`.as('tipo'),
          qtdeNf.as('qtde'),
          sql`coalesce(case when coalesce(np.vl_custo,0) = 0 then np.vrcusto else np.vl_custo end, 0)`.as('vrcusto'),
          sql`0`.as('vrvenda'), sql`coalesce(np.vrcustorep,0)`.as('vrcustorep'),
        ])
        .where(sql`coalesce(n.cancelada,'N')`, '=', 'N')
        .where(sql`n.proc`, '=', 'S').where(sql`n.tipo`, '=', 'E')
        .where('n.idempresa', 'in', empresas)
        .where('n.dtcontabil', '>=', sql`${ini}::date`)
        .where('n.dtcontabil', '<', sql`${fimExcl}::date`)
        .$if(filtrarIds, (q) => q.where('np.codproduto', 'in', ids));
      uniao = uniao.unionAll(entradas);
    }

    const mat = (await db
      .selectFrom(uniao.as('mov'))
      .select([
        'mov.dia', 'mov.codproduto', 'mov.tipo',
        sql`sum(mov.qtde)`.as('qtde'),
        sql`avg(mov.vrcusto)`.as('vrcusto'),
        sql`avg(mov.vrvenda)`.as('vrvenda'),
        sql`avg(mov.vrcustorep)`.as('vrcustorep'),
      ])
      .groupBy(['mov.dia', 'mov.codproduto', 'mov.tipo'])
      .execute()) as Record<string, unknown>[];

    // ---- pivot: célula por (produto, slot) ----
    const diaSlot = new Map(periodos.map((p) => [p.dia, p.slot]));
    const porProduto = new Map<number, Map<number, Celula>>();
    for (const m of mat) {
      const dia = String(m.dia).slice(0, 10);
      const slot = diaSlot.get(dia);
      if (slot == null) continue;
      const id = Number(m.codproduto);
      if (!porProduto.has(id)) porProduto.set(id, new Map());
      const cels = porProduto.get(id)!;
      const c = cels.get(slot) ?? { qtde: 0, vrcusto: 0, vrvenda: 0, vrcustorep: 0 };
      if (String(m.tipo) === 'E') { c.qtde_ent = r3(num(m.qtde)); c.vrcusto_ent = r4(num(m.vrcusto)); }
      else {
        c.qtde = r3(num(m.qtde)); c.vrcusto = r4(num(m.vrcusto));
        c.vrvenda = r4(num(m.vrvenda)); c.vrcustorep = r4(num(m.vrcustorep));
      }
      cels.set(slot, c);
    }

    const linhas = rows.map((r) => {
      const cels = porProduto.get(Number(r.idproduto)) ?? new Map<number, Celula>();
      const celulas = periodos.map((p) => cels.get(p.slot) ?? null);
      const totalQtde = r3(celulas.reduce((s, c) => s + (c?.qtde ?? 0), 0));
      const totalEnt = r3(celulas.reduce((s, c) => s + (c?.qtde_ent ?? 0), 0));
      // GIRO é SAÍDA, só. Contar a entrada aqui invertia o sinal: um item que RECEBEU carga e não vendeu nada
      // (a definição de encalhe) era classificado como "com giro", saía do contador de encalhe e sobrevivia
      // ao filtro "só com giro" — escondendo do comprador exatamente o que ele precisa ver.
      const comMov = celulas.filter((c) => c && c.qtde !== 0).length;
      const comEnt = celulas.filter((c) => (c?.qtde_ent ?? 0) !== 0).length;
      return {
        ...r,
        estoque: r3(num(r.estoque)), est_minimo: r3(num(r.est_minimo)), est_maximo: r3(num(r.est_maximo)),
        // última entrada é ESPARSA no golden → null, nunca 0 (a tela mostra "—")
        dtultent: r.dtultent ?? null,
        qtdeultent: r.qtdeultent == null ? null : r3(num(r.qtdeultent)),
        vrcustorep_atual: r.vrcustorep_atual == null ? null : r4(num(r.vrcustorep_atual)),
        celulas,
        total_qtde: totalQtde,
        total_qtde_entrada: comEntradas ? totalEnt : undefined,
        dias_com_movimento: comMov,
        dias_com_entrada: comEntradas ? comEnt : undefined,
        // média/dia sobre os 15 slots — é a leitura de giro que o comprador faz
        media_dia: r3(totalQtde / SLOTS),
        // CAIXAS de giro: null quando fatorcx <= 1. `1` é o DEFAULT que o legado grava quando o campo fica em
        // branco (uCadProduto.pas:7335) e vale p/ 28.407 dos 43.115 produtos — dividir por 1 devolveria a
        // quantidade em UNIDADES rotulada como "caixas", justo na tela que decide quantas caixas pedir.
        // (O legado nunca divide por FATORCX: só imprime 'UNIDADE/FATORCX' como rótulo.)
        caixas_giro: num(r.fatorcx) > 1 ? r3(totalQtde / num(r.fatorcx)) : null,
        // MÉDIA de custo/venda do período — a única coluna monetária do layout Quinzenal do legado
        // (ListaPrecFornecedorVendas_Quinzenal.fr3 → dbdListagemVRCUSTO). É a média das médias diárias
        // **pulando os dias sem movimento** (uRelListaPrecosFornecedor.pas:1676-1682, "Média dos valores que
        // tiveram movimentações") — um AVG sobre tudo divergiria.
        vrcusto_medio: mediaDeCelulas(celulas, 'vrcusto'),
        vrvenda_media: mediaDeCelulas(celulas, 'vrvenda'),
        vrcusto_ent_medio: comEntradas ? mediaDeCelulas(celulas, 'vrcusto_ent') : undefined,
      };
    });

    const visiveis = f.somenteComGiro ? linhas.filter((l) => (l as any).dias_com_movimento > 0) : linhas;
    const somar = (k: string) => r3(visiveis.reduce((s, l) => s + num((l as any)[k]), 0));
    const totais = {
      produtos: visiveis.length,
      com_giro: visiveis.filter((l) => (l as any).dias_com_movimento > 0).length,
      sem_giro: visiveis.filter((l) => (l as any).dias_com_movimento === 0).length,
      total_qtde: somar('total_qtde'),
      total_qtde_entrada: comEntradas ? somar('total_qtde_entrada') : null,
      // recebeu carga e NÃO vendeu nada no período = encalhe COM dinheiro parado; é o pior caso p/ o comprador
      // e antes ficava escondido (a entrada era contada como "giro").
      recebeu_sem_vender: comEntradas
        ? visiveis.filter((l) => (l as any).dias_com_movimento === 0 && ((l as any).dias_com_entrada ?? 0) > 0).length
        : null,
      estoque: somar('estoque'),
      sem_ultima_entrada: visiveis.filter((l) => (l as any).dtultent == null).length,
    };
    return {
      periodos, linhas: visiveis, totais,
      filtro: { ...f, empresas, dataAnalise: ancora, visualizar: comEntradas ? 'ENTRADAS_SAIDAS' : 'VENDAS', truncado, max_linhas: MAX_LINHAS },
    };
  }
}
