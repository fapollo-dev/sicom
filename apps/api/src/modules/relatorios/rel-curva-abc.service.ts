import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export type DimensaoCurva = 'PRODUTO' | 'CLIENTE' | 'FORNECEDOR';

export interface FiltroCurvaAbc {
  dtini: string; dtfim: string;
  horaIni?: string; horaFim?: string; filtrarHora?: boolean;
  canceladas?: 'N' | 'S' | 'T';
  promocao?: 'S' | 'N' | 'T';
  produto?: string; fornecedor?: string;
  departamentos?: number[]; grupos?: number[]; subgrupos?: number[]; secoes?: number[];
  aliquota?: string;
  exibirFilhos?: boolean;
  /** rel 09 (PRODUTO, default) · rel 10 (CLIENTE) · rel 11 (FORNECEDOR) */
  dimensao?: DimensaoCurva;
}

/**
 * CURVA ABC — três variantes do hub FRMRELVENDAS que compartilham a MESMA classificação e diferem na chave:
 *   rel 09 `CurvaABCProdutosVendidos`   → por PRODUTO    (uVendas.pas, GetSQL case 09)
 *   rel 10 `CurvaABCVendasCliente`      → por CLIENTE    (case 10)
 *   rel 11 `CurvaABCVendasFornecedor`   → por FORNECEDOR (case 11)
 *
 * ⚠️ A CLASSIFICAÇÃO NÃO ESTÁ NO SQL. O SQL só soma, carrega os cortes PC_CURVA_ABC_A/B/C da EMPRESA e ordena
 * por TOTAL_VENDA desc; quem atribui a letra é o PascalScript do `.fr3` (`MasterData1OnBeforePrint`), em DUAS
 * passadas — a 1ª acumula o faturamento do período, a 2ª percorre NA ORDEM mantendo `PercAcumuladoABC`.
 * Portado em `classificar()`, verbatim, com três detalhes que uma reimplementação "óbvia" erra:
 *
 *   (a) **a PRIMEIRA linha é sempre 'A'** (`if ContaPass = 1`), mesmo que sozinha estoure o corte A;
 *   (b) os cortes são **CUMULATIVOS**: PercA = A · PercB = A+B · PercC = A+B+C. O campo B não é o teto da
 *       faixa B, é a LARGURA dela — ler `pc_curva_abc_b` como teto joga metade do catálogo na faixa errada;
 *   (c) **existe faixa SEM LETRA e ela é real neste cliente.** A cadeia if/else do frx não tem `else` final:
 *       quando o acumulado cai em (PercC, 100], NENHUM ramo casa e o memo `mmABC` **conserva o texto da linha
 *       anterior**. A empresa 1 do golden é 70/15/10, que soma **95**, então toda a cauda entre 95% e 100% do
 *       faturamento passa por aí. Na prática o valor herdado é 'C', mas quem implementa `else → 'C'` acerta
 *       por acidente e erra em 75/25/0 (empresa 50), onde a herança traz 'B'. Portanto: herda-se, não se decide.
 *
 * ⚠️ AS TRÊS VARIANTES ARREDONDAM EM FRONTEIRAS DIFERENTES — é o que impede tratá-las como "a mesma query com
 * outro GROUP BY". O nível interno da rel 09 é o PRÓPRIO produto; o das rel 10/11 é (chave × **NROCUPOM**), e o
 * externo soma os cupons:
 *
 *   medida        | rel 09 produto          | rel 10 cliente          | rel 11 fornecedor
 *   qtde          | SUM(CAST(qtde,2)) linha | CAST(SUM(qtde),2) cupom | SUM(qtde) CRU
 *   vrcusto/venda | SUM(CAST(...))    linha | CAST(SUM(...))    cupom | CAST(SUM(...)) cupom
 *   desc_acre     | SUM(CAST(...))    linha | CAST(SUM(...))    cupom | CAST(SUM(...)) cupom
 *   total_custo   | SUM(CAST(qtde×custo,2)) por LINHA nas três (essa sim é comum)
 *
 * Só as medidas SOMADAS puras colapsariam; as arredondadas NÃO — o centavo nasce no cupom. E o legado agrupa o
 * cupom **só por NROCUPOM** (sem série nem data): cupons de dias diferentes com o mesmo número caem no mesmo
 * balde de arredondamento. Copiado como está.
 *
 * DIVISOR: `TotalVenda` é o faturamento de TODAS as linhas do filtro, com `sum() over ()` ANTES do teto de
 * linhas — senão o teto mudaria o % de cada linha (número errado silencioso, lição 12d).
 *
 * FÓRMULAS de bruto/acréscimo/desconto: idênticas à rel 01 (mesmo VALOR_VENDA_IAT, mesma decomposição assinada
 * de desc_acre_medio/_item) — ver `rel-vendas.service.ts` para a prova.
 */
@Injectable()
export class RelCurvaAbcService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private periodo(f: FiltroCurvaAbc) {
    if (!f.dtini || !f.dtfim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    if (String(f.dtini) > String(f.dtfim)) throw new BusinessRuleError('PERIODO_INVERTIDO', { dtini: f.dtini, dtfim: f.dtfim });
  }

  /**
   * Aplica o FFiltro do frame + o período a qualquer query que já tenha `v` (vendas), `p` (produtos) e
   * `forn` (parceiros do fornecedor) no FROM. As 4 variantes usam exatamente o mesmo frame de filtros.
   */
  private aplicarFiltros<Q extends { where: (...a: any[]) => Q }>(q: Q, f: FiltroCurvaAbc, emp: number): Q {
    let r = q.where('v.idempresa', '=', emp);
    // período: faixa na COLUNA CRUA (nunca ::date — invalidaria ix_vendas_empresa_data). Com «Filtrar Hora» é
    // UMA JANELA CONTÍNUA dtini+hi → dtfim+hf (a legenda mente; o SQL é :7003-7008), sem ela são dias inteiros.
    if (f.filtrarHora && f.horaIni && f.horaFim) {
      r = r.where('v.dtvenda', '>=', sql`${`${f.dtini} ${f.horaIni}`}::timestamptz`)
        .where('v.dtvenda', '<=', sql`${`${f.dtfim} ${f.horaFim}`}::timestamptz`);
    } else {
      r = r.where('v.dtvenda', '>=', sql`${f.dtini}::timestamptz`)
        .where('v.dtvenda', '<', sql`(${f.dtfim}::date + 1)`);
    }
    const canc = f.canceladas ?? 'N';
    if (canc === 'N') r = r.where(sql<boolean>`coalesce(v.cancelado,'N') = 'N'`);
    else if (canc === 'S') r = r.where(sql<boolean>`coalesce(v.cancelado,'N') = 'S'`);
    // promoção: sem coalesce — o legado é `= 'S'` / `= 'N'` e NULL cai fora dos DOIS ramos (fiel)
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

  async consultar(f: FiltroCurvaAbc): Promise<{
    linhas: Record<string, unknown>[];
    totais: Record<string, unknown>;
    filtro: Record<string, unknown>;
  }> {
    const emp = this.emp();
    this.periodo(f);
    const dim: DimensaoCurva = f.dimensao ?? 'PRODUTO';
    const db = this.dbp.forTenantRead() as AnyDB;

    // mesmas fórmulas da rel 01 (uVendas.pas: VALOR_VENDA_IAT + as duas metades assinadas)
    const bruto = sql`case when coalesce(v.iat,'') = 'A'
      then round((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric, 2)
      else trunc((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric * 100) / 100 end`;
    const acresc = sql`greatest(coalesce(v.desc_acre_medio,0),0) + greatest(coalesce(v.desc_acre_item,0),0)`;
    const desc = sql`coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
      + abs(least(coalesce(v.desc_acre_medio,0),0)) + abs(least(coalesce(v.desc_acre_item,0),0))`;
    const custoLinha = sql`round((coalesce(v.qtde,0) * coalesce(v.vrcusto,0))::numeric, 2)`;
    // «Exibir produtos filhos»: troca a CHAVE do relatório para o filho (fiel a :7053).
    const chaveProduto = f.exibirFilhos ? sql`coalesce(v.idproduto_filho, v.codproduto)` : sql`v.codproduto`;

    const de = () => db
      .selectFrom('vendas as v')
      .leftJoin('produtos as p', (j) => j.on(sql<boolean>`p.idproduto = ${chaveProduto}`))
      .leftJoin('empresas as e', 'e.idempresa', 'v.idempresa')
      .leftJoin('familias_prod as d', 'd.codfamilia', 'p.coddpto')
      .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
      .leftJoin('parceiros as cli', 'cli.codparceiro', 'v.codparceiro');
    const cortes = ['e.pc_curva_abc_a', 'e.pc_curva_abc_b', 'e.pc_curva_abc_c'];
    const selCortes = [
      sql`e.pc_curva_abc_a`.as('pc_curva_abc_a'),
      sql`e.pc_curva_abc_b`.as('pc_curva_abc_b'),
      sql`e.pc_curva_abc_c`.as('pc_curva_abc_c'),
    ];

    let base: any;
    if (dim === 'PRODUTO') {
      // rel 09: o nível interno JÁ é o produto — não há cupom no GROUP BY, e todo CAST é POR LINHA.
      // `qtde` é numeric(15,3) e a loja vende PESADO: 0,125 kg vira 0,13 ANTES de entrar na soma; `vrcusto` é
      // numeric(15,4) e perde as 2 últimas casas do mesmo jeito.
      base = this.aplicarFiltros(
        de().select([
          sql`p.idproduto`.as('chave'), 'v.idempresa', 'p.idproduto', 'p.codbarra',
          sql`p.descricao`.as('descricao'),
          sql`v.unidade`.as('unidade'), // ⚠️ V.UNIDADE (snapshot da venda), NÃO p.unidade — diverge em 0,4% do golden
          'v.aliquota',
          sql`d.descricao`.as('departamento'),
          ...selCortes,
          sql`round(sum(round(coalesce(v.qtde,0)::numeric, 2))::numeric, 2)`.as('qtde'),
          sql`sum(${bruto})`.as('bruto'),
          sql`round(sum(${acresc})::numeric, 2)`.as('acrescimo'),
          sql`round(sum(${desc})::numeric, 2)`.as('desc_promocao'),
          sql`round(sum(${custoLinha})::numeric, 2)`.as('total_custo'),
          sql`round(sum(round(coalesce(v.desc_acre,0)::numeric, 2))::numeric, 2)`.as('desc_acre'),
          // somas de UNITÁRIOS, fiéis ao legado: `SUM(V.VRCUSTO)` soma o valor unitário de cada linha — não é
          // média nem total, cresce com o nº de cupons. Nome explícito p/ não ser lido como total.
          sql`round(sum(round(coalesce(v.vrcusto,0)::numeric, 2))::numeric, 2)`.as('soma_vrcusto_uni'),
          sql`round(sum(round(coalesce(v.vrvenda,0)::numeric, 2))::numeric, 2)`.as('soma_vrvenda_uni'),
        ]).where(sql<boolean>`${chaveProduto} is not null`),
        f, emp,
      ).groupBy([
        'p.idproduto', 'v.idempresa', 'p.codbarra', 'p.descricao', 'v.unidade', 'v.aliquota',
        'd.descricao', ...cortes,
      ]);
    } else {
      // rel 10/11: DOIS níveis de verdade. O interno é (chave × NROCUPOM) e é ONDE NASCE O CENTAVO das medidas
      // arredondadas; o externo soma os cupons. Colapsar em uma passada mudaria vrcusto/vrvenda/desc_acre (e,
      // no cliente, também a qtde).
      const cli = dim === 'CLIENTE';
      const chave = cli ? sql`cli.codparceiro` : sql`forn.codparceiro`;
      // o legado exibe COALESCE(V.RAZAO, C.RAZAO) no cliente (o nome do CUPOM tem precedência sobre o do
      // cadastro) e F.RAZAO puro no fornecedor.
      const nome = cli ? sql`coalesce(v.razao, cli.razao)` : sql`forn.razao`;
      const porCupom = this.aplicarFiltros(
        de().select([
          sql`${chave}`.as('chave'), 'v.idempresa', sql`${nome}`.as('descricao'), 'v.nrocupom',
          ...selCortes,
          // qtde: o CLIENTE arredonda por cupom (CAST(SUM(...))); o FORNECEDOR soma CRU (o legado não casta).
          cli
            ? sql`round(sum(coalesce(v.qtde,0))::numeric, 2)`.as('qtde')
            : sql`sum(coalesce(v.qtde,0))`.as('qtde'),
          sql`sum(${bruto})`.as('bruto'),
          sql`sum(${acresc})`.as('acrescimo'),
          sql`sum(${desc})`.as('desc_promocao'),
          sql`sum(${custoLinha})`.as('total_custo'),
          sql`round(sum(coalesce(v.desc_acre,0))::numeric, 2)`.as('desc_acre'),
          sql`round(sum(coalesce(v.vrcusto,0))::numeric, 2)`.as('soma_vrcusto_uni'),
          sql`round(sum(coalesce(v.vrvenda,0))::numeric, 2)`.as('soma_vrvenda_uni'),
        ]),
        f, emp,
      ).groupBy([sql`${chave}`, 'v.idempresa', sql`${nome}`, 'v.nrocupom', ...cortes]);

      base = db.selectFrom(porCupom.as('cp')).select([
        'cp.chave', 'cp.idempresa', 'cp.descricao',
        'cp.pc_curva_abc_a', 'cp.pc_curva_abc_b', 'cp.pc_curva_abc_c',
        sql`sum(cp.qtde)`.as('qtde'),
        sql`sum(cp.bruto)`.as('bruto'),
        sql`sum(cp.acrescimo)`.as('acrescimo'),
        sql`sum(cp.desc_promocao)`.as('desc_promocao'),
        sql`sum(cp.total_custo)`.as('total_custo'),
        sql`sum(cp.desc_acre)`.as('desc_acre'),
        sql`sum(cp.soma_vrcusto_uni)`.as('soma_vrcusto_uni'),
        sql`sum(cp.soma_vrvenda_uni)`.as('soma_vrvenda_uni'),
        // colunas que só existem na variante de produto — mantidas p/ a resposta ter forma única
        sql`null::integer`.as('idproduto'), sql`null::varchar`.as('codbarra'),
        sql`null::varchar`.as('unidade'), sql`null::varchar`.as('aliquota'),
        sql`null::varchar`.as('departamento'),
      ]).groupBy([
        'cp.chave', 'cp.idempresa', 'cp.descricao',
        'cp.pc_curva_abc_a', 'cp.pc_curva_abc_b', 'cp.pc_curva_abc_c',
      ]);
    }

    // NÍVEL EXIBIDO: a aritmética do legado + o divisor da curva. `sum() over ()` roda sobre TODAS as linhas
    // agrupadas, ANTES do LIMIT — é o que garante que o teto não distorça o percentual de cada linha.
    const MAX_LINHAS = 20000;
    const externo = db
      .selectFrom(base.as('g'))
      .selectAll('g')
      .select([
        sql`(g.bruto + g.acrescimo - g.desc_promocao)`.as('total_venda'),
        sql`sum(g.bruto + g.acrescimo - g.desc_promocao) over ()`.as('total_geral'),
      ])
      // ORDER BY TOTAL_VENDA DESC é do legado; `chave` é desempate NOSSO — sem ele o PG pode devolver
      // empatados em ordem distinta a cada execução e a LETRA da linha mudaria de uma consulta p/ a outra.
      .orderBy(sql`(g.bruto + g.acrescimo - g.desc_promocao) desc, g.chave`)
      .limit(MAX_LINHAS + 1);

    const brutas = (await externo.execute()) as Record<string, unknown>[];
    const truncado = brutas.length > MAX_LINHAS;
    const rows = truncado ? brutas.slice(0, MAX_LINHAS) : brutas;
    const { linhas, faixas, totalGeral } = this.classificar(rows, dim);

    const somar = (k: string) => r2(linhas.reduce((s, l) => s + num((l as Record<string, unknown>)[k]), 0));
    const totalVendaExibido = somar('total_venda');
    const totalCusto = somar('total_custo');
    // cortes não carregados (empresa sem curva configurada): o frx classificaria TUDO como 'A' por herança do
    // ContaPass=1. A tela precisa saber disso p/ dizer "não configurada" em vez de exibir uma curva inventada.
    const semCurva = rows.length > 0 && rows.every((r) => r.pc_curva_abc_a == null && r.pc_curva_abc_b == null && r.pc_curva_abc_c == null);
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        qtde: r2(linhas.reduce((s, l) => s + num(l.qtde), 0)),
        total_venda: totalVendaExibido,
        total_custo: totalCusto,
        lucro: r2(totalVendaExibido - totalCusto),
        // o divisor da curva é o faturamento COMPLETO do filtro; com teto ele difere do exibido — e é ele
        // que manda no percentual, então vai explícito.
        total_geral: totalGeral,
        faixas,
      },
      filtro: {
        ...f, dimensao: dim, empresa: emp, truncado, max_linhas: MAX_LINHAS, sem_curva_configurada: semCurva,
        cortes: rows.length
          ? { a: num(rows[0].pc_curva_abc_a), b: num(rows[0].pc_curva_abc_b), c: num(rows[0].pc_curva_abc_c) }
          : null,
      },
    };
  }

  /** O `MasterData1OnBeforePrint` do .fr3, linha a linha na ordem do relatório. Ver (a)/(b)/(c) no cabeçalho. */
  private classificar(rows: Record<string, unknown>[], dim: DimensaoCurva) {
    const totalGeral = r2(num(rows[0]?.total_geral));
    let acumulado = 0;
    let anterior: string | null = null;
    const faixas: Record<string, { linhas: number; valor: number }> = {};
    const linhas = rows.map((r, i) => {
      const pcA = num(r.pc_curva_abc_a);
      const percA = pcA;
      const percB = pcA + num(r.pc_curva_abc_b);
      const percC = percB + num(r.pc_curva_abc_c);
      const totalVenda = r2(num(r.total_venda));
      // divisor 0 (período sem faturamento): o frx dividiria por zero. Aqui vira BRANCO — nunca 0,00, que
      // mentiria "linha sem participação" (lição 12b).
      const perc = totalGeral !== 0 ? (totalVenda * 100) / totalGeral : null;
      acumulado += perc ?? 0;

      let abc: string | null;
      let herdado = false;
      if (i === 0) abc = 'A';                                             // ContaPass = 1
      else if (acumulado <= percA) abc = 'A';
      else if (acumulado > percA && acumulado <= percB) abc = 'B';
      else if ((acumulado > percB && acumulado <= percC) || acumulado > 100) abc = 'C';
      else { abc = anterior; herdado = true; }                            // (c) o memo conserva a letra anterior
      anterior = abc;

      const custo = r2(num(r.total_custo));
      const chave = abc ?? '—';
      faixas[chave] = { linhas: (faixas[chave]?.linhas ?? 0) + 1, valor: r2((faixas[chave]?.valor ?? 0) + totalVenda) };
      return {
        dimensao: dim,
        id: r.chave, idempresa: r.idempresa,
        idproduto: r.idproduto, codbarra: r.codbarra, descricao: r.descricao,
        unidade: r.unidade, aliquota: r.aliquota, departamento: r.departamento,
        // nas variantes de parceiro a chave É o código do parceiro (cliente ou fornecedor)
        codparceiro: dim === 'PRODUTO' ? null : r.chave,
        qtde: num(r.qtde),
        total_venda: totalVenda,
        total_custo: custo,
        acrescimo: r2(num(r.acrescimo)),
        desc_promocao: r2(num(r.desc_promocao)),
        desc_acre: r2(num(r.desc_acre)),
        soma_vrcusto_uni: r2(num(r.soma_vrcusto_uni)),
        soma_vrvenda_uni: r2(num(r.soma_vrvenda_uni)),
        lucro: r2(totalVenda - custo),
        // o frx imprime com 4 casas (FormatFloat ',0.0000') — mantido, é a precisão que o operador enxerga
        perc: perc == null ? null : r4(perc),
        perc_acumulado: perc == null ? null : r4(acumulado),
        abc,
        // 'herdado' = a linha caiu na faixa sem letra e ficou com a do vizinho de cima. Sinalizado porque é
        // o comportamento que ninguém acredita até ver: não é bug do port.
        abc_herdado: herdado,
      };
    });
    return { linhas, faixas, totalGeral };
  }

  /**
   * rel 18 «Curva ABC de Vendas por Quantidade» (`CurvaABCVendasQuantidade`). **O NOME MENTE**: o `.fr3` desta
   * variante tem o `ScriptText` VAZIO (`BEGIN END.`) — não há classificação nenhuma, é um RANKING por
   * quantidade vendida. 30 linhas de SQL: empresa × código de barras × descrição, `CAST(SUM(V.QTDE) AS
   * NUMERIC(18,2))` (arredondamento no TOTAL, não por linha — de novo diferente das outras três) e
   * `ORDER BY IDEMPRESA, QTDE DESC`. Entregue como ranking, sem inventar letra que o legado não atribui.
   */
  async quantidade(f: FiltroCurvaAbc): Promise<{ linhas: Record<string, unknown>[]; totais: Record<string, unknown>; filtro: Record<string, unknown> }> {
    const emp = this.emp();
    this.periodo(f);
    const db = this.dbp.forTenantRead() as AnyDB;
    const chaveProduto = f.exibirFilhos ? sql`coalesce(v.idproduto_filho, v.codproduto)` : sql`v.codproduto`;
    const MAX_LINHAS = 20000;

    const q = this.aplicarFiltros(
      db.selectFrom('vendas as v')
        .leftJoin('produtos as p', (j) => j.on(sql<boolean>`p.idproduto = ${chaveProduto}`))
        .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
        .select([
          'v.idempresa', 'p.idproduto', 'p.codbarra', sql`p.descricao`.as('descricao'),
          sql`round(sum(coalesce(v.qtde,0))::numeric, 2)`.as('qtde'),
        ]),
      f, emp,
    ).groupBy(['v.idempresa', 'p.idproduto', 'p.codbarra', 'p.descricao'])
      // o legado ordena por IDEMPRESA, QTDE DESC; `idproduto` é desempate NOSSO (determinismo entre execuções)
      .orderBy(sql`v.idempresa, round(sum(coalesce(v.qtde,0))::numeric, 2) desc, p.idproduto`)
      .limit(MAX_LINHAS + 1);

    const brutas = (await q.execute()) as Record<string, unknown>[];
    const truncado = brutas.length > MAX_LINHAS;
    const rows = (truncado ? brutas.slice(0, MAX_LINHAS) : brutas).map((r) => ({ ...r, qtde: num(r.qtde) }));
    return {
      linhas: rows,
      totais: { linhas: rows.length, qtde: r2(rows.reduce((s, r) => s + num(r.qtde), 0)) },
      filtro: { ...f, empresa: emp, truncado, max_linhas: MAX_LINHAS },
    };
  }
}
