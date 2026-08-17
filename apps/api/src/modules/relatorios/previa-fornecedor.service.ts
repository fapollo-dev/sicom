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

const addDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const iniMes = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;
/** último dia do mês m (1-based) de y — `Date.UTC(y, m, 0)` é o dia 0 do mês seguinte. */
const fimMes = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

export interface Periodo { slot: number; rotulo: string; ini: string; fimIncl: string; dia?: string }

/**
 * As 7 periodizações do `rdgPeriodo` (uRelListaPrecosFornecedor.pas:1830-1900). Todas ancoram em `FDataAnalise`
 * e produzem SLOTS de faixa — a query da célula é a MESMA, só muda a faixa de cada coluna:
 *  · `15D` (default do .dfm) 15 dias isolados ancora−14..ancora · `5D` 5 dias isolados ancora−4..ancora
 *  · `30D` 5 blocos de 6 dias: −30..−25, −24..−19, −18..−13, −12..−7, −6..0
 *  · `5S` 5 semanas DOMINGO→SÁBADO: o legado usa `FDataAnalise − (DiaSemanaHoje−1)` como domingo-base e
 *    `DayOfWeek` do Delphi é 1=domingo, logo domingo-base = ancora − getUTCDay()
 *  · `5M` 5 meses M−4..M com virada de ano (`GetFiltroDataMes`: Mes<=0 → ano−1, mês 12+Mes)
 *  · `5A` 5 anos Y−4..Y (ano civil inteiro) · `ANUAL` os 12 meses do ano da âncora
 * DIVERGÊNCIA DELIBERADA no rótulo do `30D`: o legado monta o texto com **SYSDATE** (`GetDescPeriodo30Dias`)
 * enquanto FILTRA por `FDataAnalise` — iguais quando a âncora é hoje, mas como aqui a âncora é parâmetro, copiar
 * o bug rotularia as colunas com datas que não são as consultadas. O rótulo sai da âncora.
 */
function montarPeriodos(modo: string, ancora: string, diaDe: (n: number) => string): Periodo[] {
  const [y, m] = ancora.split('-').map(Number);
  const dd = (iso: string) => iso.slice(8, 10);
  const dias = (offsets: number[], rot: (i: number) => string): Periodo[] =>
    offsets.map((off, i) => {
      const d = diaDe(off);
      return { slot: i + 1, rotulo: rot(i), ini: d, fimIncl: d, dia: d };
    });
  const faixas = (pares: [number, number][], rot: (i: number, a: string, b: string) => string): Periodo[] =>
    pares.map(([a, b], i) => {
      const ia = diaDe(a); const fb = diaDe(b);
      return { slot: i + 1, rotulo: rot(i, ia, fb), ini: ia, fimIncl: fb };
    });

  switch (modo) {
    case '5D':
      return dias([-4, -3, -2, -1, 0], (i) => `${i + 1} DIA`);
    case '30D':
      return faixas([[-30, -25], [-24, -19], [-18, -13], [-12, -7], [-6, 0]], (_i, a, b) => `${dd(a)}/${dd(b)}`);
    case '5S': {
      const domingo = -new Date(`${ancora}T00:00:00Z`).getUTCDay(); // offset até o domingo da semana da âncora
      return faixas(
        [[domingo - 28, domingo - 22], [domingo - 21, domingo - 15], [domingo - 14, domingo - 8],
          [domingo - 7, domingo - 1], [domingo, domingo + 6]],
        (i) => `${i + 1} SEMANA`,
      );
    }
    case '5M':
      return [4, 3, 2, 1, 0].map((atras, i) => {
        const mm = m - atras;
        const [yy, mes] = mm <= 0 ? [y - 1, 12 + mm] : [y, mm];
        return { slot: i + 1, rotulo: `${i + 1} MES`, ini: iniMes(yy, mes), fimIncl: fimMes(yy, mes) };
      });
    case '5A':
      return [4, 3, 2, 1, 0].map((atras, i) => ({
        slot: i + 1, rotulo: `${i + 1} ANO`, ini: `${y - atras}-01-01`, fimIncl: `${y - atras}-12-31`,
      }));
    case 'ANUAL':
      return Array.from({ length: 12 }, (_, i) => ({
        slot: i + 1, rotulo: `${i + 1} MES`, ini: iniMes(y, i + 1), fimIncl: fimMes(y, i + 1),
      }));
    case '15D':
    default:
      return dias([-14, -13, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0], (i) => `${i + 1} DIA`);
  }
}

/**
 * Faixa do modo "Habilita Período" (`tpPorPeriodo`), fiel a `MontaSqlPorPeriodo`:
 *  · DIAS    → fim = âncora, ini = âncora − qtd
 *  · SEMANAS → fim = SÁBADO da semana da âncora (`EndOfTheWeek(date) - 1`; o `StartOfTheWeek` do Delphi é
 *              ISO/SEGUNDA nesta geração — atenção, difere do `tp5Semanas`, que ancora no DOMINGO),
 *              ini = SEGUNDA da semana de (fim − (qtd−1) semanas)
 *  · MESES   → fim = último dia do mês da âncora, ini = 1º dia do mês de (fim − (qtd−1) meses)
 *  · ANOS    → ini = 01/01 de (ano − qtd), fim = 31/12 do ano da âncora
 * ⚠️ O CONTADOR do legado é INCONSISTENTE e isto é cópia fiel: DIAS e ANOS usam `− qtd` (qtd=5 → SEIS anos
 * civis, 01/01/ano−5 a 31/12/ano), SEMANAS e MESES usam `− (qtd−1)` (qtd períodos exatos). A faixa efetiva volta
 * em `de`/`ate` para o operador ver a janela real.
 */
function faixaPorPeriodo(unidade: string, qtd: number, ancora: string): { ini: string; fimIncl: string } {
  const [y, m] = ancora.split('-').map(Number);
  switch (unidade) {
    case 'SEMANAS': {
      const dow = new Date(`${ancora}T00:00:00Z`).getUTCDay(); // 0=domingo
      const segunda = addDias(ancora, dow === 0 ? -6 : 1 - dow); // segunda da semana da âncora (ISO)
      const fimIncl = addDias(segunda, 5);                       // sábado (EndOfTheWeek − 1)
      return { ini: addDias(segunda, -7 * (qtd - 1)), fimIncl };
    }
    case 'MESES': {
      const totalMeses = (y * 12 + (m - 1)) - (qtd - 1);
      const yi = Math.floor(totalMeses / 12); const mi = (totalMeses % 12) + 1;
      return { ini: iniMes(yi, mi), fimIncl: fimMes(y, m) };
    }
    case 'ANOS':
      return { ini: `${y - qtd}-01-01`, fimIncl: `${y}-12-31` };
    case 'DIAS':
    default:
      return { ini: addDias(ancora, -qtd), fimIncl: ancora };
  }
}

export interface FiltroPrevia {
  dataAnalise?: string;
  periodizacao?: string;
  visualizar?: 'VENDAS' | 'ENTRADAS_SAIDAS';
  empresas?: number[];
  codfor?: number; idproduto?: number;
  departamento?: number; grupo?: number; subgrupo?: number; secao?: number; marca?: number;
  ativo?: number;
  somenteComGiro?: boolean;
}

export interface FiltroPrevPeriodo extends Omit<FiltroPrevia, 'periodizacao' | 'somenteComGiro'> {
  unidade?: 'DIAS' | 'SEMANAS' | 'MESES' | 'ANOS';
  quantidade?: number;
  modelo?: 'SINTETICO' | 'ANALITICO'; // rdgModelo — ANALITICO só vale c/ MESES/ANOS (Dias/Semanas força Sintético)
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
 * PRÉVIA DO FORNECEDOR / ANÁLISE DE GIRO (FRMRELLISTAPRECOSFORNECEDOR) — corte-2: as **7 periodizações** do
 * `rdgPeriodo` (15/5 Dias, 30 Dias, 5 Semanas, 5 Meses, 5 Anos, Anual — ver `montarPeriodos`) × Vendas /
 * Entradas-e-Saídas. Matriz produto × períodos: o comprador vê o giro de cada item do fornecedor e decide
 * a compra. Procedência: `uRelListaPrecosFornecedor.pas` — `GetSQL`/`Get` :1765-1830 (a célula), o dispatch de
 * período :1830-1900, e `udmRelListaPrecosFornecedor.pas:261` `GetSQLListaProdutos` (o CONJUNTO DE LINHAS).
 *
 * DUAS QUERIES, COMO O LEGADO — mas 2 round-trips em vez de 16:
 *  (a) LINHAS = PRODUTOS ⋈ ESTOQUE(empresa) + LEFT parceiros/marcas [+ INNER multi_preco quando há filtro ATIVO].
 *      O legado casa lista×períodos no cliente, então **produto SEM VENDA APARECE COM ZERO** — é o ponto do
 *      relatório (o comprador precisa ver o que NÃO girou). Mantido.
 *  (b) MATRIZ = uma passada com o SLOT resolvido por um CASE de faixas, em vez de N queries com
 *      `TRUNC(DTVENDA) BETWEEN ini AND fim`. É EQUIVALENTE: as faixas do legado são disjuntas e o CASE atribui
 *      cada linha à mesma faixa que a query dela; as agregações (SUM/AVG) são por grupo, logo os grupos e os
 *      valores são idênticos. (Mesmo raciocínio que a auditoria provou em PG para as 2 agregações da rel-vendas.)
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
 * ENTREGUE DEPOIS DO CORTE-1: `tpPorPeriodo` ("Habilita Período") em `porPeriodo()` e o modelo ANALÍTICO
 * (`fdMesesAnalitico` — uma linha por produto×mês/ano, `modelo:'ANALITICO'` + unidade MESES/ANOS).
 * ADIADO: `tvPedidos` (a diferença real vive em `qryPeriodoDiasPedidos`/`fdAnaliticoPedidos`, e a tabela
 * PEDIDOS não está migrada) · a variante Entradas-e-Saídas do período (`qryPeriodoDiasES`/`fdAnaliticoES`).
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
    periodos: Periodo[];
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
    const periodos = montarPeriodos(f.periodizacao ?? '15D', ancora, diaDe);
    const ini = periodos[0].ini;
    const fimIncl = periodos[periodos.length - 1].fimIncl;
    // faixa [ini, fim+1) — predicado na coluna CRUA, p/ usar o índice (lição 12c)
    const fimExcl = addDias(fimIncl, 1);
    // dias cobertos pela periodização inteira — denominador honesto da média/dia (nº de SLOTS só serve p/ "15 Dias").
    const diasCobertos = Math.round((Date.parse(`${fimExcl}T00:00:00Z`) - Date.parse(`${ini}T00:00:00Z`)) / 86400000);
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

    // SLOT em SQL: um CASE de faixas. Agrupar pelo DIA só serve p/ as periodizações diárias — em "5 Anos" daria
    // 1.825 grupos por produto trafegando p/ o Node. As faixas vêm de `montarPeriodos`, e a comparação é entre
    // textos 'YYYY-MM-DD' (ISO ordena cronologicamente).
    const slotExpr = sql`${periodos.reduce(
      (acc, p) => sql`${acc} when mov.dia >= ${p.ini} and mov.dia <= ${p.fimIncl} then ${p.slot}`,
      sql`case`,
    )} else null end`;
    // o CASE vai numa DERIVADA e o GROUP BY agrupa pela COLUNA. Repetir a expressão no select e no group by
    // falha: o PG casa as duas estruturalmente e os placeholders ($1.. vs $71..) não batem, então ele reclama que
    // "mov.dia" não está no GROUP BY.
    const comSlot = db
      .selectFrom(uniao.as('mov'))
      .select([
        slotExpr.as('slot'), 'mov.codproduto', 'mov.tipo',
        'mov.qtde', 'mov.vrcusto', 'mov.vrvenda', 'mov.vrcustorep',
      ]);
    const mat = (await db
      .selectFrom(comSlot.as('s'))
      .select([
        's.slot', 's.codproduto', 's.tipo',
        sql`sum(s.qtde)`.as('qtde'),
        sql`avg(s.vrcusto)`.as('vrcusto'),
        sql`avg(s.vrvenda)`.as('vrvenda'),
        sql`avg(s.vrcustorep)`.as('vrcustorep'),
      ])
      .where('s.slot', 'is not', null)   // linha fora de toda faixa (periodização com buraco) não vira grupo
      .groupBy(['s.slot', 's.codproduto', 's.tipo'])
      .execute()) as Record<string, unknown>[];

    // ---- pivot: célula por (produto, slot) ----
    const porProduto = new Map<number, Map<number, Celula>>();
    for (const m of mat) {
      const slot = m.slot == null ? null : Number(m.slot);
      if (slot == null || !Number.isFinite(slot)) continue; // fora de toda faixa (periodização com buraco)
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
        // média/DIA sobre os dias realmente cobertos pela periodização — dividir pelo nº de slots só coincidiria
        // em "15 Dias"; em "5 Meses" daria média por MÊS com nome de média por dia.
        media_dia: r3(totalQtde / diasCobertos),
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
      filtro: {
        ...f, empresas, dataAnalise: ancora, periodizacao: f.periodizacao ?? '15D',
        visualizar: comEntradas ? 'ENTRADAS_SAIDAS' : 'VENDAS',
        de: ini, ate: fimIncl, dias_cobertos: diasCobertos, truncado, max_linhas: MAX_LINHAS,
      },
    };
  }

  /**
   * "Habilita Período" (`tpPorPeriodo`) — a 2ª geração do cálculo (`MontaSqlPorPeriodo` + `qryPeriodoDias`):
   * UMA faixa livre (unidade × quantidade) e UMA linha de totais por produto, em vez da matriz de slots.
   * Com `modelo:'ANALITICO'` (rdgModelo=1, só MESES/ANOS): `fdMesesAnalitico` — a mesma união ganha
   * `extract(month|year …)` no SELECT/GROUP BY e sai uma linha por (produto, mês/ano), ORDER BY descrição, mês.
   * A grade do legado COLAPSA para 1 linha/produto (AtualizaListagemAnalitico soma QTD; custo/valor da 1ª linha)
   * e o FR3 imprime o detalhe mensal — aqui devolvemos o DETALHE (o colapso é apresentação, deriva no front).
   *
   * FIEL: mesma união `vendas` ∪ NF-saída (CFOP dos 8), `SUM(qtde)` + `AVG(custo/venda/custorep)`, o join com
   * PRODUTOS/ESTOQUE **DENTRO** do agregado — logo este modo lista **só quem teve movimento** (na matriz de slots
   * o produto sem giro aparece com zero, porque lá a lista é uma query separada). `GROUP BY codproduto, descricao,
   * unidade, fatorcx, codbarra` + `ORDER BY descricao`, como no .dfm.
   *
   * DIVERGÊNCIA DELIBERADA (1): o legado seleciona `p.qtde as estoque` no interno e `sum(estoque)` no externo —
   * ou seja soma o saldo do produto UMA VEZ POR LINHA DE MOVIMENTO, devolvendo `saldo × nº de linhas`. Um item com
   * 45 em estoque e 100 movimentos exibiria 4.500. Além de errado, `produtos.qtde` não existe no schema novo (o
   * saldo vive em `estoque`, por empresa). Aqui o estoque sai de `estoque` na empresa do escopo, uma vez.
   *
   * DIVERGÊNCIA DELIBERADA (2) — auditoria do corte analítico: no `fdMesesAnalitico` o legado agrupa/ordena pela
   * DESCRIÇÃO DA LINHA de movimento (`V.DESCRICAO`/`NP.DESCRICAO`), não pela do cadastro — produto renomeado no
   * meio da faixa (ou NF com descrição própria) sai em MAIS de uma linha por (produto, mês). `vendas`/`nf_prod`
   * não têm descrição no schema novo (não migrada) → aqui é sempre `p.descricao`, 1 linha por (produto, mês).
   *
   * DIVERGÊNCIA DELIBERADA (3) — auditoria: o filtro ATIVO (multi_preco) é MORTO no caminho "Habilita Período"
   * do legado — `MontaSqlPorPeriodo` recebe o `pJoin` do GetFiltroIdxAtivo e NUNCA o injeta (as queries nem têm
   * o marcador substituído), embora o combo fique habilitado na tela. Aqui o filtro FUNCIONA nos dois modelos
   * (upgrade consciente: o operador que seleciona "Ativo p/ compra = S" espera o filtro aplicado, não ignorado).
   */
  async porPeriodo(f: FiltroPrevPeriodo): Promise<{
    linhas: Record<string, unknown>[]; totais: Record<string, number | null>; filtro: Record<string, unknown>;
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const empresas = (f.empresas?.length ? f.empresas.map(Number) : [emp]).filter((e) => e === emp);
    if (!empresas.length) throw new BusinessRuleError('EMPRESA_FORA_DO_ESCOPO', { empresas: f.empresas });

    const tz = String((await this.config.resolver('FUSO_HORARIO_ACESSO', { empresaId: emp })) ?? 'America/Sao_Paulo');
    const hojeLocal = (await sql<{ d: string }>`select to_char(now() at time zone ${tz}, 'YYYY-MM-DD') as d`
      .execute(db)).rows[0].d;
    const ancora = f.dataAnalise ?? hojeLocal;
    if (Number.isNaN(Date.parse(`${ancora}T00:00:00Z`)) || addDias(ancora, 0) !== ancora) {
      throw new BusinessRuleError('DATA_ANALISE_INVALIDA', { dataAnalise: ancora });
    }
    const unidade = f.unidade ?? 'DIAS';
    const quantidade = Number(f.quantidade ?? 15);
    const { ini, fimIncl } = faixaPorPeriodo(unidade, quantidade, ancora);
    const fimExcl = addDias(fimIncl, 1);
    const diasCobertos = Math.round((Date.parse(`${fimExcl}T00:00:00Z`) - Date.parse(`${ini}T00:00:00Z`)) / 86400000);

    // MODELO (rdgModelo): ANALÍTICO = fdMesesAnalitico — a MESMA união com `/*campo*/ = extract(month|year …)`
    // no SELECT/GROUP BY, uma linha por (produto, mês/ano). Só existe p/ MESES/ANOS: em Dias/Semanas o legado
    // FORÇA Sintético (cbPeriodoChange: rdgModelo.ItemIndex:=0 + Enabled:=False) — downgrade silencioso aqui,
    // refletido no `filtro.modelo` da resposta. Fuso: dtvenda é timestamptz → extract no fuso do negócio;
    // dtcontabil é date → extract direto (o legado extrai de DTCONTABIL puro).
    const analitico = f.modelo === 'ANALITICO' && (unidade === 'MESES' || unidade === 'ANOS');
    const campoData = unidade === 'ANOS' ? sql.raw('year') : sql.raw('month');
    const mesVendas = analitico ? sql`extract(${campoData} from v.dtvenda at time zone ${tz})::int` : sql`0`;
    const mesNf = analitico ? sql`extract(${campoData} from n.dtcontabil)::int` : sql`0`;

    const CFOP_SAIDA = [5102, 6102, 5402, 6402, 5403, 6403, 5405, 6405];
    const qtdeNf = sql`coalesce(np.quantidade * (case when (np.fatorembal is null or np.fatorembal = 0) then 1 else np.fatorembal end), 0)`;

    const movVendas = db.selectFrom('vendas as v')
      .select([
        sql`v.codproduto`.as('codproduto'), sql`coalesce(v.qtde,0)`.as('qtde'),
        sql`coalesce(v.vrcusto,0)`.as('vrcusto'), sql`coalesce(v.vrvenda,0)`.as('vrvenda'),
        sql`coalesce(v.vrcustorep,0)`.as('vrcustorep'),
        mesVendas.as('mes'),
      ])
      .where(sql`coalesce(v.cancelado,'N')`, '=', 'N')
      .where('v.idempresa', 'in', empresas)
      // limites no fuso do negócio (o balde de dia não existe aqui, mas a BORDA da faixa sim)
      .where('v.dtvenda', '>=', sql`(${ini}::timestamp at time zone ${tz})`)
      .where('v.dtvenda', '<', sql`(${fimExcl}::timestamp at time zone ${tz})`);

    const movNf = db.selectFrom('nf as n')
      .innerJoin('nf_prod as np', 'np.codnf', 'n.codnf')
      .select([
        sql`np.codproduto`.as('codproduto'), qtdeNf.as('qtde'),
        sql`coalesce(np.vl_custo,0)`.as('vrcusto'),
        sql`coalesce(case when coalesce(np.vrvenda,0) = 0 then np.vrcusto else np.vrvenda end, 0)`.as('vrvenda'),
        sql`coalesce(np.vrcustorep,0)`.as('vrcustorep'),
        mesNf.as('mes'),
      ])
      .where(sql`coalesce(n.cancelada,'N')`, '=', 'N')
      .where(sql`n.proc`, '=', 'S').where(sql`n.tipo`, '=', 'S')
      .where('n.idempresa', 'in', empresas)
      .where('n.dtcontabil', '>=', sql`${ini}::date`)
      .where('n.dtcontabil', '<', sql`${fimExcl}::date`)
      .where('n.cfop', 'in', CFOP_SAIDA);

    let q = db
      .selectFrom(movVendas.unionAll(movNf).as('mov'))
      .innerJoin('produtos as p', 'p.idproduto', 'mov.codproduto')
      // ESTOQUE é INNER como no legado (é ele que ancora a empresa na lista de produtos)
      .innerJoin('estoque as e', (j) => j.onRef('e.idproduto', '=', 'p.idproduto').on('e.idempresa', 'in', empresas))
      .leftJoin('parceiros as pa', 'pa.codparceiro', 'p.codfor')
      .leftJoin('marcas as ma', 'ma.idmarca', 'p.idmarca')
      .leftJoin('multi_preco as m', (j) => j.onRef('m.idproduto', '=', 'e.idproduto').onRef('m.idempresa', '=', 'e.idempresa'))
      .select([
        'p.idproduto', 'p.codbarra', sql`p.descricao`.as('descricao'), 'p.unidade', 'p.fatorcx', 'p.codfor',
        sql`pa.fantasia`.as('fornecedor'),
        sql`mov.mes`.as('mes'), // 0 no sintético (grupo único); mês/ano no analítico
        sql`sum(mov.qtde)`.as('qtde'),
        sql`avg(mov.vrcusto)`.as('vrcusto'),
        sql`avg(mov.vrvenda)`.as('vrvenda'),
        sql`avg(mov.vrcustorep)`.as('vrcustorep'),
        // estoque UMA vez (ver a divergência no docblock): max() sobre a linha única de estoque da empresa
        sql`max(e.qtde)`.as('estoque'), sql`max(e.minimo)`.as('est_minimo'), sql`max(e.maximo)`.as('est_maximo'),
        sql`to_char(max(e.dtent) at time zone ${tz},'YYYY-MM-DD')`.as('dtultent'),
        sql`max(e.qtde_ent)`.as('qtdeultent'),
      ])
      .groupBy(['p.idproduto', 'p.codbarra', 'p.descricao', 'p.unidade', 'p.fatorcx', 'p.codfor', 'pa.fantasia', sql`mov.mes`]);

    // filtros de valor ÚNICO, iguais aos da matriz (MontaFiltroSQL é compartilhado pelos dois caminhos)
    if (f.codfor != null) q = q.where('pa.codparceiro', '=', Number(f.codfor));
    if (f.idproduto != null) q = q.where('p.idproduto', '=', Number(f.idproduto));
    if (f.secao != null) q = q.where('p.codsecao', '=', Number(f.secao));
    if (f.departamento != null) q = q.where('p.coddpto', '=', Number(f.departamento));
    if (f.marca != null) q = q.where('ma.idmarca', '=', Number(f.marca));
    if (f.grupo != null) q = q.where('p.codgrupo', '=', Number(f.grupo));
    if (f.subgrupo != null) q = q.where('p.codsubgrupo', '=', Number(f.subgrupo));
    const at = (c: string, v: string) => sql<boolean>`coalesce(m.${sql.raw(c)},'S') = ${v}`;
    if (f.ativo === 1) q = q.where(at('ativo_compra', 'S'));
    if (f.ativo === 2) q = q.where(at('ativo', 'S'));
    if (f.ativo === 3) q = q.where(at('ativo_compra', 'N'));
    if (f.ativo === 4) q = q.where(at('ativo', 'N'));
    if (f.ativo === 5) q = q.where(at('ativo_compra', 'S')).where(at('ativo', 'S'));
    if (f.ativo === 6) q = q.where(at('ativo_compra', 'N')).where(at('ativo', 'N'));
    if (f.ativo != null) q = q.where('m.idproduto', 'is not', null);

    const MAX_LINHAS = 20000;
    // ordem fiel: ORDER BY DESCRICAO (sintético) / DESCRICAO, mes (analítico — fdMesesAnalitico)
    const brutas = (await q.orderBy(sql`p.descricao`).orderBy(sql`mov.mes`).limit(MAX_LINHAS + 1).execute()) as Record<string, unknown>[];
    const truncado = brutas.length > MAX_LINHAS;
    const linhas = (truncado ? brutas.slice(0, MAX_LINHAS) : brutas).map((r) => {
      const qt = r3(num(r.qtde));
      return {
        ...r,
        mes: analitico ? Number(r.mes) : undefined, // só o analítico expõe a dimensão
        qtde: qt,
        vrcusto: r4(num(r.vrcusto)), vrvenda: r4(num(r.vrvenda)),
        vrcustorep: r.vrcustorep == null ? null : r4(num(r.vrcustorep)),
        estoque: r3(num(r.estoque)), est_minimo: r3(num(r.est_minimo)), est_maximo: r3(num(r.est_maximo)),
        dtultent: r.dtultent ?? null,
        qtdeultent: r.qtdeultent == null ? null : r3(num(r.qtdeultent)),
        // média/dia e caixas são medidas da FAIXA INTEIRA — numa linha mensal enganariam; só no sintético
        media_dia: analitico ? null : r3(qt / diasCobertos),
        caixas_giro: !analitico && num(r.fatorcx) > 1 ? r3(qt / num(r.fatorcx)) : null,
      };
    });
    // totais: no analítico o MESMO produto tem N linhas (uma por mês) — produtos/estoque contam por produto
    // DISTINTO (somar estoque por linha repetiria o saldo N×, o bug de sum(estoque) que já evitamos no legado).
    const porProduto = new Map<number, { estoque: number; semEnt: boolean }>();
    for (const l of linhas) {
      const id = Number((l as Record<string, unknown>).idproduto);
      if (!porProduto.has(id)) porProduto.set(id, { estoque: num(l.estoque), semEnt: l.dtultent == null });
    }
    const totais = {
      produtos: porProduto.size,
      total_qtde: r3(linhas.reduce((s, l) => s + num(l.qtde), 0)),
      estoque: r3(Array.from(porProduto.values()).reduce((s, v) => s + v.estoque, 0)),
      sem_ultima_entrada: Array.from(porProduto.values()).filter((v) => v.semEnt).length,
    };
    return {
      linhas, totais,
      filtro: {
        ...f, empresas, dataAnalise: ancora, unidade, quantidade,
        modelo: analitico ? 'ANALITICO' : 'SINTETICO', // efetivo (Dias/Semanas força Sintético, como cbPeriodoChange)
        de: ini, ate: fimIncl, dias_cobertos: diasCobertos, truncado, max_linhas: MAX_LINHAS,
        // este modo lista SÓ quem teve movimento (join dentro do agregado) — a tela avisa, p/ não parecer filtro sumido
        somente_com_movimento: true,
      },
    };
  }

}
