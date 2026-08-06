import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export interface FiltroCurvaAbc {
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
 * CURVA ABC DE PRODUTOS VENDIDOS — rel 09 do hub FRMRELVENDAS.
 * Procedência: `uVendas.pas` TVendas.CurvaABCProdutosVendidos (:7000-7130, despacho `GetSQL` case 09).
 *
 * ⚠️ A CLASSIFICAÇÃO NÃO ESTÁ NO SQL. O SQL só soma por produto, carrega os cortes PC_CURVA_ABC_A/B/C da
 * EMPRESA e ordena por TOTAL_VENDA desc; quem atribui a letra é o PascalScript do relatório
 * `Relatorios/ven2_09 - Curva_ABC_ Produtos_vendidos.fr3` (`MasterData1OnBeforePrint`), em DUAS PASSADAS:
 * a 1ª acumula `TotalVenda` (o faturamento do período inteiro) e a 2ª percorre as linhas NA ORDEM e mantém
 * `PercAcumuladoABC`. Portado aqui em TS, verbatim, com três detalhes que uma reimplementação "óbvia" erra:
 *
 *   (a) **a PRIMEIRA linha é sempre 'A'** (`if ContaPass = 1`), mesmo que sozinha estoure o corte A;
 *   (b) os cortes são **CUMULATIVOS**: PercA = A · PercB = A+B · PercC = A+B+C. O campo B não é o teto da
 *       faixa B, é a LARGURA dela — ler `pc_curva_abc_b` como teto joga metade do catálogo na faixa errada;
 *   (c) **existe faixa SEM LETRA e ela é real neste cliente.** A cadeia if/else do frx não tem `else` final:
 *       quando o acumulado cai em (PercC, 100], NENHUM ramo casa e o memo `mmABC` **conserva o texto da linha
 *       anterior**. Não é hipótese de laboratório — a empresa 1 do golden é 70/15/10, que soma **95**, então
 *       toda a cauda entre 95% e 100% do faturamento passa por aí. Na prática o valor herdado é 'C' (o
 *       acumulado é monótono, então quem chega lá vinha de C), mas quem implementa `else → 'C'` acerta por
 *       acidente e erra em 75/25/0 (empresa 50), onde a herança traz 'B'. Portanto: herda-se, não se decide.
 *
 * DIVISOR: `TotalVenda` é o faturamento de TODAS as linhas do filtro, e é calculado com `sum() over ()`
 * ANTES do teto de linhas — senão o teto mudaria o % de cada produto (número errado silencioso, lição 12d).
 *
 * FÓRMULAS: idênticas à rel 01 (mesmo VALOR_VENDA_IAT, mesma decomposição assinada de desc_acre_medio/_item),
 * porque é o mesmo dado — ver `rel-vendas.service.ts` para a prova de que Σround ≡ round(Σ) aqui.
 *
 * DUAS PASSADAS DO LEGADO ≡ UMA AQUI (e desta vez é trivial): o GROUP BY EXTERNO do legado é o INTERNO mais
 * `DESC_ACRE`, que é agregado no interno e portanto FUNCIONALMENTE DETERMINADO pelas chaves internas — cada
 * grupo externo tem exatamente 1 linha. O externo só existe para fazer a aritmética
 * `TOTAL_VENDA + ACRESCIMO − DESC_PROMOCAO`. (Contraste com o Ticket Médio, onde o externo CONTA grupos e os
 * dois níveis não colapsam — lição 32.)
 *
 * VR. CUSTO / VR. VENDA: o legado faz `SUM(V.VRCUSTO)` e `SUM(V.VRVENDA)` — soma os valores UNITÁRIOS de cada
 * linha de venda. Não é média nem total; é uma soma de unitários, que cresce com o nº de cupons do produto.
 * Copiado como está (é o que a grade mostra), mas exposto com nome explícito para não ser lido como total.
 */
@Injectable()
export class RelCurvaAbcService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(f: FiltroCurvaAbc): Promise<{
    linhas: Record<string, unknown>[];
    totais: Record<string, unknown>;
    filtro: Record<string, unknown>;
  }> {
    const emp = this.emp();
    if (!f.dtini || !f.dtfim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    if (String(f.dtini) > String(f.dtfim)) throw new BusinessRuleError('PERIODO_INVERTIDO', { dtini: f.dtini, dtfim: f.dtfim });
    const db = this.dbp.forTenantRead() as AnyDB;

    // mesmas fórmulas da rel 01 (uVendas.pas: VALOR_VENDA_IAT + as duas metades assinadas)
    const bruto = sql`case when coalesce(v.iat,'') = 'A'
      then round((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric, 2)
      else trunc((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric * 100) / 100 end`;
    const acresc = sql`greatest(coalesce(v.desc_acre_medio,0),0) + greatest(coalesce(v.desc_acre_item,0),0)`;
    const desc = sql`coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
      + abs(least(coalesce(v.desc_acre_medio,0),0)) + abs(least(coalesce(v.desc_acre_item,0),0))`;
    // «Exibir produtos filhos»: troca a CHAVE do relatório para o filho (fiel a :7053).
    const chaveProduto = f.exibirFilhos ? sql`coalesce(v.idproduto_filho, v.codproduto)` : sql`v.codproduto`;

    let base = db
      .selectFrom('vendas as v')
      .leftJoin('produtos as p', (j) => j.on(sql<boolean>`p.idproduto = ${chaveProduto}`))
      .leftJoin('empresas as e', 'e.idempresa', 'v.idempresa')
      .leftJoin('familias_prod as d', 'd.codfamilia', 'p.coddpto')
      .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
      .select([
        'v.idempresa', 'p.idproduto', 'p.codbarra',
        sql`p.descricao`.as('descricao'),
        sql`v.unidade`.as('unidade'), // ⚠️ V.UNIDADE (snapshot da venda), NÃO p.unidade — diverge em 0,4% do golden
        'v.aliquota',
        sql`d.descricao`.as('departamento'),
        sql`e.pc_curva_abc_a`.as('pc_curva_abc_a'),
        sql`e.pc_curva_abc_b`.as('pc_curva_abc_b'),
        sql`e.pc_curva_abc_c`.as('pc_curva_abc_c'),
        // ⚠️ CAST(x AS NUMERIC(18,2)) POR LINHA, depois SUM — é o que o legado escreve, e não é decoração:
        // `qtde` é numeric(15,3) e a loja vende PESADO, então 0,125 kg vira 0,13 ANTES de entrar na soma;
        // `vrcusto` é numeric(15,4) e perde as 2 últimas casas do mesmo jeito. Somar cru e arredondar no fim
        // dá outro número na cauda de hortifrúti/açougue — exatamente onde a curva ABC é consultada.
        sql`round(sum(round(coalesce(v.qtde,0)::numeric, 2))::numeric, 2)`.as('qtde'),
        sql`sum(${bruto})`.as('bruto'),
        sql`round(sum(${acresc})::numeric, 2)`.as('acrescimo'),
        sql`round(sum(${desc})::numeric, 2)`.as('desc_promocao'),
        sql`round(sum(round((coalesce(v.qtde,0) * coalesce(v.vrcusto,0))::numeric, 2))::numeric, 2)`.as('total_custo'),
        sql`round(sum(round(coalesce(v.desc_acre,0)::numeric, 2))::numeric, 2)`.as('desc_acre'),
        // somas de UNITÁRIOS, fiéis ao legado (ver cabeçalho) — nome explícito p/ não virar "total"
        sql`round(sum(round(coalesce(v.vrcusto,0)::numeric, 2))::numeric, 2)`.as('soma_vrcusto_uni'),
        sql`round(sum(round(coalesce(v.vrvenda,0)::numeric, 2))::numeric, 2)`.as('soma_vrvenda_uni'),
      ])
      .where('v.idempresa', '=', emp)
      .where(sql<boolean>`${chaveProduto} is not null`);

    // período: faixa na COLUNA CRUA (nunca ::date — invalidaria ix_vendas_empresa_data). Com «Filtrar Hora» é
    // UMA JANELA CONTÍNUA dtini+hi → dtfim+hf (a legenda mente; o SQL é :7003-7008), sem ela são dias inteiros.
    if (f.filtrarHora && f.horaIni && f.horaFim) {
      base = base.where('v.dtvenda', '>=', sql`${`${f.dtini} ${f.horaIni}`}::timestamptz`)
        .where('v.dtvenda', '<=', sql`${`${f.dtfim} ${f.horaFim}`}::timestamptz`);
    } else {
      base = base.where('v.dtvenda', '>=', sql`${f.dtini}::timestamptz`)
        .where('v.dtvenda', '<', sql`(${f.dtfim}::date + 1)`);
    }
    const canc = f.canceladas ?? 'N';
    if (canc === 'N') base = base.where(sql<boolean>`coalesce(v.cancelado,'N') = 'N'`);
    else if (canc === 'S') base = base.where(sql<boolean>`coalesce(v.cancelado,'N') = 'S'`);
    // promoção: sem coalesce — o legado é `= 'S'` / `= 'N'` e NULL cai fora dos DOIS ramos (fiel)
    if (f.promocao === 'S') base = base.where('v.promocao', '=', 'S');
    if (f.promocao === 'N') base = base.where('v.promocao', '=', 'N');
    if (f.produto) base = base.where(sql<boolean>`upper(p.descricao) like ${`%${f.produto.toUpperCase()}%`}`);
    if (f.fornecedor) base = base.where(sql<boolean>`upper(forn.razao) like ${`%${f.fornecedor.toUpperCase()}%`}`);
    if (f.departamentos?.length) base = base.where('p.coddpto', 'in', f.departamentos.map(Number));
    if (f.grupos?.length) base = base.where('p.codgrupo', 'in', f.grupos.map(Number));
    if (f.subgrupos?.length) base = base.where('p.codsubgrupo', 'in', f.subgrupos.map(Number));
    if (f.secoes?.length) base = base.where('p.codsecao', 'in', f.secoes.map(Number));
    if (f.aliquota) base = base.where(sql<boolean>`v.aliquota like ${`%${f.aliquota}%`}`);

    base = base.groupBy([
      'v.idempresa', 'p.idproduto', 'p.codbarra', 'p.descricao', 'v.unidade', 'v.aliquota',
      'd.descricao', 'e.pc_curva_abc_a', 'e.pc_curva_abc_b', 'e.pc_curva_abc_c',
    ]);

    // NÍVEL EXTERNO: a aritmética do legado + o divisor da curva. `sum() over ()` roda sobre TODAS as linhas
    // agrupadas, ANTES do LIMIT — é o que garante que o teto não distorça o percentual de cada produto.
    const MAX_LINHAS = 20000;
    const externo = db
      .selectFrom(base.as('g'))
      .selectAll('g')
      .select([
        sql`(g.bruto + g.acrescimo - g.desc_promocao)`.as('total_venda'),
        sql`sum(g.bruto + g.acrescimo - g.desc_promocao) over ()`.as('total_geral'),
      ])
      // ORDER BY TOTAL_VENDA DESC é do legado; `idproduto` é desempate NOSSO — sem ele o PG pode devolver
      // empatados em ordem distinta a cada execução e a LETRA da linha mudaria de uma consulta p/ a outra.
      .orderBy(sql`(g.bruto + g.acrescimo - g.desc_promocao) desc, g.idproduto`)
      .limit(MAX_LINHAS + 1);

    const brutas = (await externo.execute()) as Record<string, unknown>[];
    const truncado = brutas.length > MAX_LINHAS;
    const rows = truncado ? brutas.slice(0, MAX_LINHAS) : brutas;

    const totalGeral = r2(num(rows[0]?.total_geral));
    // cortes não carregados (empresa sem curva configurada): o frx classificaria TUDO como 'A' por herança do
    // ContaPass=1. A tela precisa saber disso p/ dizer "não configurada" em vez de exibir uma curva inventada.
    const semCurva = rows.length > 0 && rows.every((r) => r.pc_curva_abc_a == null && r.pc_curva_abc_b == null && r.pc_curva_abc_c == null);

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
      // mentiria "produto sem participação" (lição 12b).
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
        idempresa: r.idempresa, idproduto: r.idproduto, codbarra: r.codbarra, descricao: r.descricao,
        unidade: r.unidade, aliquota: r.aliquota, departamento: r.departamento,
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

    const somar = (k: string) => r2(linhas.reduce((s, l) => s + num((l as Record<string, unknown>)[k]), 0));
    const totalVendaExibido = somar('total_venda');
    const totalCusto = somar('total_custo');
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
        ...f, empresa: emp, truncado, max_linhas: MAX_LINHAS, sem_curva_configurada: semCurva,
        cortes: rows.length
          ? { a: num(rows[0].pc_curva_abc_a), b: num(rows[0].pc_curva_abc_b), c: num(rows[0].pc_curva_abc_c) }
          : null,
      },
    };
  }
}
