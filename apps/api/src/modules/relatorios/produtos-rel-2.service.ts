import { Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { FUSO_LOJA } from '../../shared/tempo/hoje';
import type { FiltroEstoque } from './produtos-rel.service';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
type Linha = Record<string, unknown>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const soma = (ls: Linha[], c: string) => r2(ls.reduce((s, l) => s + num(l[c]), 0));

/** os relatórios do corte 2 (recon de 25/09/2026, na produção): os oito que o dado prova vivos */
export type TipoProdutosRel2 =
  | 'ESTOQUE_VENDAS_PERIODO' // 15 Estoque atual/vendas período
  | 'ESTOQUE_POR_DATA' //       6 Estoque por data
  | 'MIX_ESTOQUE_LOJA' //      18 Comparativo de mix (estoque × loja)
  | 'MIX_ESTOQUE_GIROS' //     19 Comparativo de mix (estoque × giros)
  | 'LOTES_VALIDADES' //       11 Lotes e validades
  | 'PERCAS' //                 9 Percas
  | 'LISTA_CONFERENCIA' //      1 Lista para conferência
  | 'INATIVOS_AGENDA' //       14 Produtos inativos em agenda de promoções
  | 'PRODUTOS_FORNECEDOR'; //  17 Produtos por fornecedor

export const TIPOS_PRODUTOS_REL_2: readonly TipoProdutosRel2[] = [
  'ESTOQUE_VENDAS_PERIODO', 'ESTOQUE_POR_DATA', 'MIX_ESTOQUE_LOJA', 'MIX_ESTOQUE_GIROS', 'LOTES_VALIDADES', 'PERCAS', 'LISTA_CONFERENCIA', 'INATIVOS_AGENDA',
  'PRODUTOS_FORNECEDOR',
];

/** o `cbbAtivo` do legado: "Todos" (sem filtro) e as seis combinações de compra/venda (P:1107-1118) */
export type AtivoModo = 'COMPRA_S' | 'VENDA_S' | 'COMPRA_N' | 'VENDA_N' | 'AMBOS_S' | 'AMBOS_N';

export interface FiltroProdutosRel2 {
  tipo: TipoProdutosRel2;
  /** as empresas marcadas (`GetMultiEmpresa`); vazio = a do login */
  empresas?: number[] | null;
  produto?: string | null;
  coddpto?: number | null;
  codgrupo?: number | null;
  codsubgrupo?: number | null;
  codsecao?: number | null;
  codfor?: number | null;
  /** o `cbbAtivo` (as 6 combinações); o `ativo` S/N do corte-1 equivale a "ativos/inativos p/ venda" */
  ativoModo?: AtivoModo | null;
  ativo?: 'S' | 'N' | null;
  filtroEstoque?: FiltroEstoque | null;
  /** o `cbbEstoque` × `cbbSinal` × `edtEstoqueQtde`: sem `estoqueEm`, sem filtro (o combo nasce vazio a cada troca de relatório) */
  estoqueEm?: 'TODOS' | 'ESTOQUE' | 'DEPOSITO' | null;
  estoqueSinal?: '>' | '=' | '<' | null;
  estoqueQtde?: number | null;
  local?: string | null;
  lotes?: string | null;
  dataIni?: string | null;
  dataFim?: string | null;
}

export interface ResultadoProdutosRel2 {
  tipo: TipoProdutosRel2;
  linhas: Linha[];
  totais: Record<string, number>;
  /** MIX_ESTOQUE_GIROS: "Última execução do giros" (PROCESSOS.GIROS) */
  ultimoGiro?: string | null;
}

/**
 * RELATÓRIOS DE PRODUTOS (`FRMPRODUTOSREL`) — **corte 2**: os oito relatórios do combo que o dado da produção prova vivos (recon de
 * 25/09/2026, só leitura; o dossiê dava três deles como mortos por ter medido a tabela errada). Numeração do combo = `ItemIndex`.
 *
 * O núcleo "genérico" do legado (`FDqProdutos`, itens 1 e 15) parte de PRODUTOS × MULTI_PRECO das empresas marcadas, com ESTOQUE e
 * ESTOQUE_DEP da mesma empresa, e aplica os filtros por texto (`GeraConsulta`, P:1030-1741). Os filtros que o legado deixa "grudados"
 * de um relatório para o outro (o `cmbFiltro` = 14 que a Ruptura força, o `IdProduto` que não zera ao limpar o campo) são estado de
 * tela, não regra: aqui cada consulta leva só os filtros que o operador pediu.
 */
@Injectable()
export class ProdutosRel2Service {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** as empresas marcadas, recortadas às do operador (`GetMultiEmpresa` → RELACAO_OPERADOR_EMPRESA; a do login sempre entra) */
  private async empresas(db: AnyDB, pedidas: number[] | null | undefined): Promise<number[]> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const rel = op == null ? [] : ((await db.selectFrom('relacao_operador_empresa').select('codempresa').where('codoperador', '=', op).execute()) as Array<{ codempresa: number }>).map((r) => Number(r.codempresa));
    const permitidas = [...new Set([emp, ...rel])];
    const lista = (pedidas?.length ? pedidas : [emp]).filter((e) => permitidas.includes(e));
    if (!lista.length) throw new BusinessRuleError('EMPRESA_FORA_DO_ESCOPO', { empresas: pedidas });
    return lista;
  }

  private periodo(f: FiltroProdutosRel2): { ini: string; fim: string } {
    if (!f.dataIni || !f.dataFim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    return { ini: f.dataIni, fim: f.dataFim };
  }

  /** o produto do filtro: código interno, código de barras ou parte da descrição */
  private produto(alias: string, texto: string): RawBuilder<unknown> {
    const t = texto.trim();
    return /^\d+$/.test(t)
      ? sql`(${sql.ref(`${alias}.idproduto`)}::text = ${t} OR ${sql.ref(`${alias}.codbarra`)} = ${t})`
      : sql`${sql.ref(`${alias}.descricao`)} ILIKE ${`%${t}%`}`;
  }

  /** família e fornecedor do cadastro (o produto do filtro também) */
  private filtrosCadastro(f: FiltroProdutosRel2, alias: string, opts: { secao?: boolean; fornecedor?: boolean } = {}): RawBuilder<unknown>[] {
    const c = (col: string) => sql.ref(`${alias}.${col}`);
    const out: RawBuilder<unknown>[] = [];
    if (f.produto?.trim()) out.push(this.produto(alias, f.produto));
    if (f.coddpto) out.push(sql`${c('coddpto')} = ${f.coddpto}`);
    if (f.codgrupo) out.push(sql`${c('codgrupo')} = ${f.codgrupo}`);
    if (f.codsubgrupo) out.push(sql`${c('codsubgrupo')} = ${f.codsubgrupo}`);
    if (opts.secao !== false && f.codsecao) out.push(sql`${c('codsecao')} = ${f.codsecao}`);
    if (opts.fornecedor !== false && f.codfor) out.push(sql`${c('codfor')} = ${f.codfor}`);
    return out;
  }

  /**
   * O `cbbAtivo` (P:1107-1118): ATIVO_COMPRA e/ou ATIVO, cada um contando o NULL dos dois lados (`… OR ATIVO IS NULL`), lidos da
   * MULTI_PRECO da linha quando a config ATIVO_PELA_MULTIPRECO = 'S' e do PRODUTO senão. Na produção a config é 'N' na base e 'S' no
   * override "Modulo / Todos" → efetivo 'S' (o recon que leu só a base errou); o `ConfigService` resolve o override como o legado.
   */
  private async filtroAtivo(f: FiltroProdutosRel2, aliasProduto: string, aliasMulti: string | null): Promise<RawBuilder<unknown>[]> {
    const modo: AtivoModo | null = f.ativoModo ?? (f.ativo === 'S' ? 'VENDA_S' : f.ativo === 'N' ? 'VENDA_N' : null);
    if (!modo) return [];
    const pelaMulti = aliasMulti != null
      && String((await this.config.resolver('ATIVO_PELA_MULTIPRECO', { empresaId: this.emp() })) ?? 'N').toUpperCase() === 'S';
    const a = pelaMulti ? aliasMulti! : aliasProduto;
    const cond = (col: 'ativo' | 'ativo_compra', v: 'S' | 'N') => sql`(${sql.ref(`${a}.${col}`)} = ${v} OR ${sql.ref(`${a}.${col}`)} IS NULL)`;
    switch (modo) {
      case 'COMPRA_S': return [cond('ativo_compra', 'S')];
      case 'VENDA_S': return [cond('ativo', 'S')];
      case 'COMPRA_N': return [cond('ativo_compra', 'N')];
      case 'VENDA_N': return [cond('ativo', 'N')];
      case 'AMBOS_S': return [cond('ativo_compra', 'S'), cond('ativo', 'S')];
      case 'AMBOS_N': return [cond('ativo_compra', 'N'), cond('ativo', 'N')];
    }
  }

  /** os filtros de estoque do núcleo genérico (B = ESTOQUE, DE = ESTOQUE_DEP da empresa da linha) */
  private filtrosEstoque(f: FiltroProdutosRel2): RawBuilder<unknown>[] {
    return this.filtrosEstoqueAlias(f, 'b', 'de');
  }

  private filtrosEstoqueAlias(f: FiltroProdutosRel2, aliasB: string, aliasDe: string): RawBuilder<unknown>[] {
    const b = (c: string) => sql.ref(`${aliasB}.${c}`), d = (c: string) => sql.ref(`${aliasDe}.${c}`);
    const out: RawBuilder<unknown>[] = [];
    const sinal = sql.raw(f.estoqueSinal === '<' ? '<' : f.estoqueSinal === '=' ? '=' : '>');
    const n = Number(f.estoqueQtde ?? 0);
    // "Todos" exige as DUAS (loja e depósito) — com o ESTOQUE_DEP zerado, "Todos > 0" não traz nada, como no legado
    if (f.estoqueEm === 'TODOS') out.push(sql`coalesce(${b('qtde')}, 0) ${sinal} ${n} AND coalesce(${d('qtde')}, 0) ${sinal} ${n}`);
    if (f.estoqueEm === 'ESTOQUE') out.push(sql`coalesce(${b('qtde')}, 0) ${sinal} ${n}`);
    if (f.estoqueEm === 'DEPOSITO') out.push(sql`coalesce(${d('qtde')}, 0) ${sinal} ${n}`);
    const q = sql`coalesce(${b('qtde')}, 0)`, mi = sql`coalesce(${b('minimo')}, 0)`, ma = sql`coalesce(${b('maximo')}, 0)`;
    const cmp: Partial<Record<FiltroEstoque, RawBuilder<unknown>>> = {
      MENOR_IGUAL_MINIMO: sql`${q} <= ${mi}`, MENOR_MINIMO: sql`${q} < ${mi}`, MAIOR_IGUAL_MINIMO: sql`${q} >= ${mi}`, MAIOR_MINIMO: sql`${q} > ${mi}`,
      IGUAL_MINIMO: sql`${q} = ${mi}`, MENOR_IGUAL_MAXIMO: sql`${q} <= ${ma}`, MENOR_MAXIMO: sql`${q} < ${ma}`, MAIOR_IGUAL_MAXIMO: sql`${q} >= ${ma}`,
      MAIOR_MAXIMO: sql`${q} > ${ma}`, IGUAL_MAXIMO: sql`${q} = ${ma}`, NEGATIVA: sql`${q} < 0`, ZERADA: sql`${q} = 0`, MAIOR_ZERO: sql`${q} > 0`,
      NEGATIVA_OU_ZERADA: sql`${q} <= 0`,
    };
    const c = f.filtroEstoque ? cmp[f.filtroEstoque] : undefined;
    if (c) out.push(c);
    if (f.local?.trim()) out.push(sql`${b('local')} ILIKE ${`%${f.local.trim()}%`}`);
    return out;
  }

  async gerar(f: FiltroProdutosRel2): Promise<ResultadoProdutosRel2> {
    const db = this.dbp.forTenantRead() as AnyDB;
    switch (f.tipo) {
      case 'ESTOQUE_VENDAS_PERIODO': return this.estoqueVendasPeriodo(db, f);
      case 'ESTOQUE_POR_DATA': return this.estoquePorData(db, f);
      case 'MIX_ESTOQUE_LOJA': return this.mixEstoqueLoja(db, f);
      case 'MIX_ESTOQUE_GIROS': return this.mixEstoqueGiros(db, f);
      case 'LOTES_VALIDADES': return this.lotesValidades(db, f);
      case 'PERCAS': return this.percas(db, f);
      case 'LISTA_CONFERENCIA': return this.listaConferencia(db, f);
      case 'INATIVOS_AGENDA': return this.inativosAgenda(db, f);
      case 'PRODUTOS_FORNECEDOR': return this.produtosFornecedor(db, f);
    }
  }

  /**
   * 15 — ESTOQUE ATUAL × VENDAS NO PERÍODO (`GetSQLEstoqueAtualVendasPeriodo`, P:1920-1984). O núcleo genérico com a venda do período
   * por produto e empresa: quantidade, total de venda (bruto: arredonda com IAT 'A', trunca nos demais — ABNT) e de custo, e os
   * unitários MÉDIOS do período (total ÷ quantidade, 2 casas). Produto sem venda: quantidade vendida NULA (não 0). A SEÇÃO filtra só a
   * venda (P:1940): a lista segue com todos os produtos. O estoque em valor é o do SEM_INCIDENCIA: (loja + depósito) × custo/venda
   * atual só quando positivo — negativo vale R$ 0. Produção: VENDAS 19 milhões, ~7 mil/dia.
   */
  private async estoqueVendasPeriodo(db: AnyDB, f: FiltroProdutosRel2): Promise<ResultadoProdutosRel2> {
    const { ini, fim } = this.periodo(f);
    const emps = await this.empresas(db, f.empresas);
    const filtroVenda = this.filtrosCadastro(f, 'p', { fornecedor: false });
    const onde = [sql`m.idempresa IN (${sql.join(emps)})`, ...this.filtrosCadastro(f, 'a', { secao: false }), ...(await this.filtroAtivo(f, 'a', 'm')), ...this.filtrosEstoque(f)];
    const linhas = (await sql<Linha>`
      WITH vp AS (
        SELECT codproduto, idempresa, qtde, total_venda, total_custo,
               round(total_venda / nullif(qtde, 0), 2) AS vrvenda_uni,
               round(total_custo / nullif(qtde, 0), 2) AS vrcusto_uni
          FROM (SELECT v.codproduto, v.idempresa, sum(v.qtde) AS qtde,
                       sum(round((v.qtde * v.vrcusto)::numeric, 2)) AS total_custo,
                       sum(CASE WHEN v.iat = 'A' THEN round((v.qtde * v.vrvenda)::numeric, 2)
                                ELSE trunc((v.qtde * v.vrvenda)::numeric * 100) / 100 END) AS total_venda
                  FROM vendas v
                  JOIN produtos p ON p.idproduto = v.codproduto
                 WHERE v.dtvenda >= (${ini}::date::timestamp AT TIME ZONE ${FUSO_LOJA})
                   AND v.dtvenda <  ((${fim}::date + 1)::timestamp AT TIME ZONE ${FUSO_LOJA})
                   AND v.idempresa IN (${sql.join(emps)}) AND v.cancelado = 'N'
                   ${filtroVenda.length ? sql`AND ${sql.join(filtroVenda, sql` AND `)}` : sql``}
                 GROUP BY v.codproduto, v.idempresa) cur)
      SELECT m.idempresa, a.coddpto, dp.descricao AS departamento, a.idproduto, a.codbarra, a.descricao, a.unidade,
             a.codfor, pa.razao AS fornecedor,
             coalesce(de.qtde, 0) AS qtde_dep, coalesce(b.qtde, 0) AS qtde,
             CASE WHEN coalesce(b.qtde, 0) + coalesce(de.qtde, 0) > 0
                  THEN round(((coalesce(b.qtde, 0) + coalesce(de.qtde, 0)) * m.vrcusto)::numeric, 2) ELSE 0 END AS totalcusto,
             CASE WHEN coalesce(b.qtde, 0) + coalesce(de.qtde, 0) > 0
                  THEN round(((coalesce(b.qtde, 0) + coalesce(de.qtde, 0)) * m.vrvenda)::numeric, 2) ELSE 0 END AS totalvenda,
             vp.qtde AS qtde_vendida, vp.total_venda, vp.total_custo, vp.vrcusto_uni, vp.vrvenda_uni,
             m.vrcusto, m.vrvenda
        FROM produtos a
        JOIN multi_preco m         ON m.idproduto = a.idproduto
        LEFT JOIN estoque b        ON b.idproduto = m.idproduto AND b.idempresa = m.idempresa
        LEFT JOIN estoque_dep de   ON de.idproduto = m.idproduto AND de.idempresa = m.idempresa
        LEFT JOIN familias_prod dp ON dp.codfamilia = a.coddpto AND dp.tipo = 'D'
        LEFT JOIN parceiros pa     ON pa.codparceiro = a.codfor
        LEFT JOIN vp               ON vp.codproduto = a.idproduto AND vp.idempresa = m.idempresa
       WHERE ${sql.join(onde, sql` AND `)}
       ORDER BY m.idempresa, a.codfor, pa.razao, a.descricao
       LIMIT 20001`.execute(db)).rows;
    return {
      tipo: f.tipo, linhas,
      totais: { itens: linhas.length, qtde: soma(linhas, 'qtde'), qtdeDep: soma(linhas, 'qtde_dep'), totalCusto: soma(linhas, 'totalcusto'),
        totalVenda: soma(linhas, 'totalvenda'), qtdeVendida: soma(linhas, 'qtde_vendida'), vendaPeriodo: soma(linhas, 'total_venda') },
    };
  }

  /**
   * 6 — ESTOQUE POR DATA (`FDqProd`, D:2765-2880). O saldo de cada produto na data é o `QTDE_ATUAL` (o `saldo_novo`) do último
   * movimento do HISTORICO_PROD até a data final 23:59:59 — a produção tem 14,7 milhões de movimentos e o último saldo bate com o
   * ESTOQUE em 100% dos produtos que mexeram na semana (recon). O depósito vem do HISTORICO_PROD_DEP, morto (19 linhas até 2023,
   * fora da carga): coluna 0. Valores a custo e venda ATUAIS (MULTI_PRECO) × saldo, em 2 casas (o CAST(… AS NUMERIC(18,2)) do legado,
   * que também arredonda o saldo). O filtro de saldo vale sempre (o combo só tem "Saldo", P:1277): `saldo {>|=|<} N`, padrão "> 0" — o
   * produto sem movimento até a data não aparece, e o saldo negativo só aparece com "Menor que". Desempate de dois movimentos no mesmo
   * instante (a nota do Apollo grava vários na mesma transação): o de código maior; o legado casa por DATA sem empresa (sem colisão na
   * produção: 0 pares repetidos em 2026).
   */
  private async estoquePorData(db: AnyDB, f: FiltroProdutosRel2): Promise<ResultadoProdutosRel2> {
    if (!f.dataFim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    const emps = await this.empresas(db, f.empresas);
    const sinal = sql.raw(f.estoqueSinal === '<' ? '<' : f.estoqueSinal === '=' ? '=' : '>');
    const onde = [sql`m.idempresa IN (${sql.join(emps)})`, ...this.filtrosCadastro(f, 'p', { secao: false, fornecedor: false }),
      ...(await this.filtroAtivo(f, 'p', 'm')), sql`s.saldo ${sinal} ${Number(f.estoqueQtde ?? 0)}`];
    const linhas = (await sql<Linha>`
      WITH s AS (
        SELECT DISTINCT ON (h.idempresa, h.idproduto) h.idempresa, h.idproduto, h.saldo_novo AS saldo
          FROM historico_prod h
         WHERE h.idempresa IN (${sql.join(emps)})
           AND h.data <= ((${f.dataFim}::date + time '23:59:59') AT TIME ZONE ${FUSO_LOJA})
         ORDER BY h.idempresa, h.idproduto, h.data DESC, h.codmov DESC)
      SELECT p.idproduto, m.idempresa, p.codbarra, p.descricao, p.coddpto, p.codgrupo, p.codsubgrupo,
             round(m.vrcusto::numeric, 2) AS vrcusto, round(m.vrvenda::numeric, 2) AS vrvenda,
             round(coalesce(s.saldo, 0)::numeric, 2) AS qtde_estoque,
             round((m.vrcusto * coalesce(s.saldo, 0))::numeric, 2) AS custo_estoque,
             round((m.vrvenda * coalesce(s.saldo, 0))::numeric, 2) AS venda_estoque,
             0 AS qtde_deposito, 0 AS custo_deposito, 0 AS venda_deposito,
             round(coalesce(s.saldo, 0)::numeric, 2) AS total_estoque,
             round((m.vrcusto * coalesce(s.saldo, 0))::numeric, 2) AS custo_total,
             round((m.vrvenda * coalesce(s.saldo, 0))::numeric, 2) AS venda_total
        FROM produtos p
        JOIN multi_preco m ON m.idproduto = p.idproduto
        LEFT JOIN s        ON s.idproduto = p.idproduto AND s.idempresa = m.idempresa
       WHERE ${sql.join(onde, sql` AND `)}
       ORDER BY m.idempresa, p.idproduto
       LIMIT 20001`.execute(db)).rows;
    return {
      tipo: f.tipo, linhas,
      totais: { itens: linhas.length, saldo: soma(linhas, 'total_estoque'), custo: soma(linhas, 'custo_total'), venda: soma(linhas, 'venda_total') },
    };
  }

  /**
   * 18 — COMPARATIVO DE MIX, ESTOQUE × LOJA (`GetSQLComparativoMixEstoqueXLojas`, P:1841-1879). A empresa do LOGIN faz o papel de
   * depósito/CD; as marcadas são as lojas: lista o que tem estoque no CD (loja + depósito > 0) e está sem estoque (≤ 0) em alguma loja,
   * com as lojas sem estoque juntas ("2, 51"). A loja precisa ter a linha de ESTOQUE do produto (o legado filtra `E.` no WHERE). O
   * legado encadeia o ESTOQUE do CD no ESTOQUE_DEP (sem a linha do depósito o produto some); aqui cada um conta por si (na produção
   * todas as linhas existem). Produção, logado na 1: 8.421 produtos com estoque, 5.053 sem estoque na 2.
   */
  private async mixEstoqueLoja(db: AnyDB, f: FiltroProdutosRel2): Promise<ResultadoProdutosRel2> {
    const cd = this.emp();
    const lojas = (await this.empresas(db, f.empresas)).filter((e) => e !== cd);
    if (!lojas.length) throw new BusinessRuleError('MIX_SEM_LOJA');
    const onde = [
      sql`(coalesce(del.qtde, 0) + coalesce(eel.qtde, 0)) > 0`,
      sql`(coalesce(e.qtde, 0) + coalesce(ed.qtde, 0)) <= 0`,
      sql`e.idempresa IN (${sql.join(lojas)})`,
      ...this.filtrosCadastro(f, 'p'),
      ...(await this.filtroAtivo(f, 'p', 'mcd')), // a MULTI_PRECO do CD (o legado a liga ao ESTOQUE_DEP do CD)
    ];
    const linhas = (await sql<Linha>`
      SELECT idproduto, codbarra, descricao, qtde, string_agg(idempresa::text, ', ' ORDER BY idempresa) AS lojas_sem_estoque
        FROM (SELECT p.idproduto, p.codbarra, p.descricao, coalesce(del.qtde, 0) + coalesce(eel.qtde, 0) AS qtde, e.idempresa
                FROM produtos p
                LEFT JOIN estoque_dep del ON del.idproduto = p.idproduto AND del.idempresa = ${cd}
                LEFT JOIN estoque eel     ON eel.idproduto = p.idproduto AND eel.idempresa = ${cd}
                LEFT JOIN multi_preco mcd ON mcd.idproduto = p.idproduto AND mcd.idempresa = ${cd}
                JOIN estoque e            ON e.idproduto = p.idproduto
                LEFT JOIN estoque_dep ed  ON ed.idproduto = p.idproduto AND ed.idempresa = e.idempresa
               WHERE ${sql.join(onde, sql` AND `)}) x
       GROUP BY idproduto, codbarra, descricao, qtde
       ORDER BY descricao
       LIMIT 20001`.execute(db)).rows;
    return { tipo: f.tipo, linhas, totais: { itens: linhas.length, qtde: soma(linhas, 'qtde') } };
  }

  /**
   * 19 — COMPARATIVO DE MIX, ESTOQUE × GIROS (`GetSQLComparativoMixEstoqueXGiros`, P:1881-1918). O estoque (loja + depósito) medido
   * na empresa do LOGIN — como no 18, o CD — e o "sem giro" avaliado em cada empresa marcada: os produtos que o CD tem e que não
   * tiveram movimento (MOVIMENTACAO_DIARIA, a rotina GIROS) no período naquela empresa. O título do grupo é a empresa marcada. Produção:
   * 5.535 de 8.421 produtos com estoque na 1 sem giro nos últimos 30 dias. "Última execução do giros": PROCESSOS.GIROS.
   */
  private async mixEstoqueGiros(db: AnyDB, f: FiltroProdutosRel2): Promise<ResultadoProdutosRel2> {
    const { ini, fim } = this.periodo(f);
    const cd = this.emp();
    const emps = await this.empresas(db, f.empresas);
    const onde = [sql`m.idempresa IN (${sql.join(emps)})`, ...this.filtrosCadastro(f, 'p'), ...(await this.filtroAtivo(f, 'p', 'm'))];
    const linhas = (await sql<Linha>`
      SELECT x.idproduto, x.codbarra, x.descricao, x.idempresa, em.razao_social, x.total_estoque
        FROM (SELECT p.idproduto, p.codbarra, p.descricao, m.idempresa, coalesce(e.qtde, 0) + coalesce(d.qtde, 0) AS total_estoque
                FROM produtos p
                JOIN multi_preco m       ON m.idproduto = p.idproduto
                LEFT JOIN estoque e      ON e.idproduto = p.idproduto AND e.idempresa = ${cd}
                LEFT JOIN estoque_dep d  ON d.idproduto = p.idproduto AND d.idempresa = ${cd}
               WHERE ${sql.join(onde, sql` AND `)}) x
        LEFT JOIN empresas em ON em.idempresa = x.idempresa
       WHERE x.total_estoque > 0
         AND NOT EXISTS (SELECT 1 FROM movimentacao_diaria z
                          WHERE z.codproduto = x.idproduto AND z.idempresa = x.idempresa AND z.data BETWEEN ${ini}::date AND ${fim}::date)
       ORDER BY x.idempresa, x.descricao
       LIMIT 20001`.execute(db)).rows;
    const g = (await sql<{ ini: string | null }>`SELECT to_char(inicioexecucao AT TIME ZONE ${FUSO_LOJA}, 'YYYY-MM-DD HH24:MI') AS ini FROM processos WHERE nomeprocesso = 'GIROS'`.execute(db)).rows[0];
    return { tipo: f.tipo, linhas, totais: { itens: linhas.length, estoque: soma(linhas, 'total_estoque') }, ultimoGiro: g?.ini ?? null };
  }

  /**
   * 11 — LOTES E VALIDADES (`sqqProdutosLoteVal`, D:1089-1224): os lotes das NF de ENTRADA (NF_PROD_LOTE — 132 mil lotes, NF até
   * 24/09/2026; 2.979 vencem até o fim de 2026) com validade no período, e o estoque, os preços e as famílias do produto na empresa da
   * nota. O 2º ramo (LOTE_PRODUTO_VALIDADE) é morto (1 linha de 2021, fora da carga). Filtros: empresas, período de validade
   * (obrigatório), produto, fornecedor do cadastro, família, seção e lotes separados por ";". Como no legado, sem filtro de nota
   * cancelada — a coluna `cancelada` mostra (1 lote hoje). As descrições de família não dependem de o produto ter linha de ESTOQUE (o
   * legado as condiciona a isso e a seção à empresa da família: 1.917 das 2.472 têm empresa nula).
   */
  private async lotesValidades(db: AnyDB, f: FiltroProdutosRel2): Promise<ResultadoProdutosRel2> {
    const { ini, fim } = this.periodo(f);
    const emps = await this.empresas(db, f.empresas);
    const onde = [sql`nf.idempresa IN (${sql.join(emps)})`, sql`nl.dtvalidade BETWEEN ${ini}::date AND ${fim}::date`,
      ...this.filtrosCadastro(f, 'a')];
    const lotes = (f.lotes ?? '').split(';').map((l) => l.trim()).filter(Boolean);
    if (lotes.length) onde.push(sql`nl.lote IN (${sql.join(lotes)})`);
    const linhas = (await sql<Linha>`
      SELECT nf.idempresa, a.idproduto, a.codbarra, a.descricao, a.unidade, a.fatorcx, b.qtde AS estoque_atual,
             CASE a.atacado WHEN 'N' THEN 'VAREJO' ELSE 'ATACADO' END AS atacadovarejo,
             coalesce(m.vrcusto, 0) AS vrcusto, coalesce(m.vrcustorep, 0) AS vrcustorep, coalesce(m.vrvenda, 0) AS vrvenda,
             pa.razao AS fornecedor, sc.descricao AS dessecao, dp.descricao AS descdepto, g.descricao AS descgrupo, sg.descricao AS descsubgrupo,
             nl.lote, to_char(nl.dtvalidade, 'YYYY-MM-DD') AS dtvalidade, nf.codnf, nf.nronf, np.nroitem, pn.fantasia AS fornecedor_nf,
             coalesce(nf.cancelada, 'N') AS cancelada
        FROM produtos a
        JOIN nf_prod np            ON np.codproduto = a.idproduto
        JOIN nf_prod_lote nl       ON nl.codnfprod = np.codnfprod
        LEFT JOIN nf               ON nf.codnf = np.codnf
        LEFT JOIN multi_preco m    ON m.idproduto = a.idproduto AND m.idempresa = nf.idempresa
        LEFT JOIN estoque b        ON b.idproduto = a.idproduto AND b.idempresa = nf.idempresa
        LEFT JOIN familias_prod g  ON g.codfamilia = a.codgrupo AND g.tipo = 'G'
        LEFT JOIN familias_prod sg ON sg.codfamilia = a.codsubgrupo AND sg.tipo = 'S'
        LEFT JOIN familias_prod dp ON dp.codfamilia = a.coddpto AND dp.tipo = 'D'
        LEFT JOIN familias_prod sc ON sc.codfamilia = a.codsecao AND sc.tipo = 'O'
        LEFT JOIN parceiros pa     ON pa.codparceiro = a.codfor
        LEFT JOIN parceiros pn     ON pn.codparceiro = nf.codparceiro
       WHERE ${sql.join(onde, sql` AND `)}
       ORDER BY a.descricao, a.idproduto, nf.idempresa, nl.dtvalidade
       LIMIT 20001`.execute(db)).rows;
    return { tipo: f.tipo, linhas, totais: { itens: linhas.length, produtos: new Set(linhas.map((l) => l.idproduto)).size } };
  }

  /**
   * 9 — PERCAS (`FDqPercas`, D:2376-2762): por empresa e produto COM perca no período (o `HAVING SUM(SI.QTDE) > 0` é fixo — o rádio
   * "somente com perca" procura um marcador que não existe), a quantidade perdida (SCRAP_ITEM), o valor pelo custo GRAVADO no item da
   * perca (Σ qtde × VR_CUSTO), as ENTRADAS do período (NF de entrada processada nas CFOPs de compra, quantidade × fator, + ajuste
   * AUMENTAR), as SAÍDAS (NF de saída processada fora de 5929/6929 × fator + a MOVIMENTACAO_DIARIA + ajuste DIMINUIR), o saldo inicial
   * do balanço nº 1 e o % de perca = perda ÷ entradas × 100 (0 sem entrada). Produção: SCRAP 3.795 / SCRAP_ITEM 133.613, ~1.000 a
   * 1.500 itens por mês. ⚠️ O dado tem um item de 139.502 unidades (scrap 16155, 22/08/2026 — código de barras digitado na quantidade).
   */
  private async percas(db: AnyDB, f: FiltroProdutosRel2): Promise<ResultadoProdutosRel2> {
    const { ini, fim } = this.periodo(f);
    const emps = await this.empresas(db, f.empresas);
    const E = sql.join(emps);
    const onde = this.filtrosCadastro(f, 'pr', { secao: false });
    const noDia = (col: string) => sql`${sql.ref(col)} >= (${ini}::date::timestamp AT TIME ZONE ${FUSO_LOJA}) AND ${sql.ref(col)} < ((${fim}::date + 1)::timestamp AT TIME ZONE ${FUSO_LOJA})`;
    const linhas = (await sql<Linha>`
      WITH perca AS (
        SELECT s.idempresa, si.idproduto, sum(si.qtde) AS qtd_percas, sum(si.qtde * si.vr_custo) AS valor_percas
          FROM scrap s JOIN scrap_item si ON si.codscrap = s.codscrap
         WHERE ${noDia('s.dt_cadastro')} AND s.idempresa IN (${E})
         GROUP BY s.idempresa, si.idproduto
        HAVING sum(si.qtde) > 0),
      mov AS (
        SELECT b.codempresa AS idempresa, b.idproduto, b.qtde AS saldo_inicial, 0::numeric AS entradas, 0::numeric AS saidas
          FROM (SELECT DISTINCT codempresa, idproduto, qtde FROM balancoitens WHERE codbalanco = 1 AND codempresa IN (${E})) b
        UNION ALL
        SELECT n.idempresa, np.codproduto, 0,
               sum(CASE WHEN n.tipo = 'E' AND np.cfop IN ('1102', '2102', '1403', '2403', '1910', '2910', '1152', '1409', '1157')
                        THEN np.quantidade * np.fatorembal ELSE 0 END),
               sum(CASE WHEN n.tipo = 'S' AND coalesce(np.cfop, '') NOT IN ('5929', '6929') THEN np.quantidade * np.fatorembal ELSE 0 END)
          FROM nf n JOIN nf_prod np ON np.codnf = n.codnf
         WHERE n.dtcontabil BETWEEN ${ini}::date AND ${fim}::date AND n.idempresa IN (${E}) AND n.proc = 'S' AND n.cancelada = 'N'
           AND EXISTS (SELECT 1 FROM perca pc WHERE pc.idproduto = np.codproduto)
         GROUP BY n.idempresa, np.codproduto
        UNION ALL
        SELECT v.idempresa, v.codproduto, 0, 0, sum(v.qtde)
          FROM movimentacao_diaria v
         WHERE v.data BETWEEN ${ini}::date AND ${fim}::date AND v.idempresa IN (${E})
         GROUP BY v.idempresa, v.codproduto
        UNION ALL
        SELECT e.idempresa, e.idproduto, 0,
               sum(CASE WHEN e.operacao = 'AUMENTAR' THEN e.qtde ELSE 0 END), sum(CASE WHEN e.operacao = 'DIMINUIR' THEN e.qtde ELSE 0 END)
          FROM ajuste_estoque e
         WHERE ${noDia('e.data')} AND e.operacao IN ('AUMENTAR', 'DIMINUIR') AND e.idempresa IN (${E})
         GROUP BY e.idempresa, e.idproduto),
      p2 AS (
        SELECT idempresa, idproduto, sum(saldo_inicial) AS saldo_inicial, sum(entradas) AS entradas, sum(saidas) AS saidas
          FROM mov GROUP BY idempresa, idproduto)
      SELECT pc.idempresa, pc.idproduto, pr.codbarra, pr.descricao, pr.unidade, pr.coddpto, pr.codgrupo, pr.codsubgrupo,
             coalesce(p2.saldo_inicial, 0) AS saldo_inicial, coalesce(p2.entradas, 0) AS entradas, coalesce(p2.saidas, 0) AS saidas,
             coalesce(p2.saldo_inicial, 0) + coalesce(p2.entradas, 0) - coalesce(p2.saidas, 0) AS saldo,
             pc.qtd_percas, round(pc.valor_percas::numeric, 2) AS valor_percas,
             CASE WHEN coalesce(p2.entradas, 0) = 0 THEN 0 ELSE round((pc.qtd_percas / p2.entradas * 100)::numeric, 2) END AS perc_percas
        FROM perca pc
        LEFT JOIN p2           ON p2.idempresa = pc.idempresa AND p2.idproduto = pc.idproduto
        LEFT JOIN produtos pr  ON pr.idproduto = pc.idproduto
       ${onde.length ? sql`WHERE ${sql.join(onde, sql` AND `)}` : sql``}
       ORDER BY pc.idempresa, pc.idproduto
       LIMIT 20001`.execute(db)).rows;
    return {
      tipo: f.tipo, linhas,
      totais: { itens: linhas.length, qtdPercas: soma(linhas, 'qtd_percas'), valorPercas: soma(linhas, 'valor_percas'), entradas: soma(linhas, 'entradas') },
    };
  }

  /**
   * 1 — LISTA PARA CONFERÊNCIA (o núcleo genérico, P:1735-1740): a folha de contagem física, por empresa e fornecedor, com a
   * quantidade da loja e do depósito e as duas colunas em branco para anotar a contagem (`prod_Lista_Conferencia.fr3`). Seção não
   * existe neste ramo. Ordem: empresa, fornecedor (razão), descrição.
   */
  private async listaConferencia(db: AnyDB, f: FiltroProdutosRel2): Promise<ResultadoProdutosRel2> {
    const emps = await this.empresas(db, f.empresas);
    const onde = [sql`m.idempresa IN (${sql.join(emps)})`, ...this.filtrosCadastro(f, 'a', { secao: false }), ...this.filtrosEstoque(f)];
    const linhas = (await sql<Linha>`
      SELECT m.idempresa, em.fantasia AS empresa, a.codfor, pa.razao AS fornecedor, a.idproduto, a.codbarra, a.descricao, a.unidade,
             coalesce(b.qtde, 0) AS qtde, coalesce(de.qtde, 0) AS qtde_dep, b.local
        FROM produtos a
        JOIN multi_preco m       ON m.idproduto = a.idproduto
        LEFT JOIN estoque b      ON b.idproduto = m.idproduto AND b.idempresa = m.idempresa
        LEFT JOIN estoque_dep de ON de.idproduto = m.idproduto AND de.idempresa = m.idempresa
        LEFT JOIN parceiros pa   ON pa.codparceiro = a.codfor
        LEFT JOIN empresas em    ON em.idempresa = m.idempresa
       WHERE ${sql.join(onde, sql` AND `)}
       ORDER BY m.idempresa, pa.razao, a.descricao
       LIMIT 20001`.execute(db)).rows;
    return { tipo: f.tipo, linhas, totais: { itens: linhas.length, qtde: soma(linhas, 'qtde'), qtdeDep: soma(linhas, 'qtde_dep') } };
  }

  /**
   * 14 — PRODUTOS INATIVOS EM AGENDA DE PROMOÇÕES (P:2563-2636): os ITENS de agenda desativados (`ag_i.ativo = 'N'` — não o produto
   * inativo: o dossiê mediu o predicado errado), com o preço de venda da empresa do login e o da promoção. Sem recorte de data nem de
   * empresa da agenda (o legado traz todo o histórico). Produção: 953 itens, 83 de agendas de 2026, o último desativado em 14/09/2026.
   */
  private async inativosAgenda(db: AnyDB, f: FiltroProdutosRel2): Promise<ResultadoProdutosRel2> {
    const emp = this.emp();
    const onde = [sql`ag_i.ativo = 'N'`, ...this.filtrosCadastro(f, 'pr', { secao: false })];
    const linhas = (await sql<Linha>`
      SELECT ag.codagenda, ag.nomepromo, pr.idproduto, pr.codbarra, pr.descricao, pr.unidade, d.descricao AS depto,
             ag_i.atualizacao_grupo, ag_i.tv, ag_i.radio, ag_i.tabloide, ag_i.interno, m.vrvenda, ag_i.vlrpromocao,
             to_char(ag_i.dtativo, 'YYYY-MM-DD') AS dtativo
        FROM agenda_promocao_itens ag_i
        JOIN agenda_promocao ag   ON ag.codagenda = ag_i.codagenda
        JOIN produtos pr          ON pr.idproduto = ag_i.idproduto
        LEFT JOIN familias_prod d ON d.codfamilia = pr.coddpto AND d.tipo = 'D'
        JOIN multi_preco m        ON m.idproduto = ag_i.idproduto AND m.idempresa = ${emp}
       WHERE ${sql.join(onde, sql` AND `)}
       ORDER BY ag.codagenda, ag.nomepromo, pr.descricao
       LIMIT 20001`.execute(db)).rows;
    return { tipo: f.tipo, linhas, totais: { itens: linhas.length } };
  }

  /**
   * 17 — PRODUTOS POR FORNECEDOR (`GetSQLProdutosPorFornecedor`, P:1999-2131): cada produto sob o fornecedor da sua ÚLTIMA NOTA DE
   * ENTRADA (o emitente — não o CODFOR do cadastro), com o código e a descrição do produto NA NOTA, custo, fator, a quantidade e a data
   * daquela nota, a quantidade vendida desde então, o estoque atual e o estoque logo depois da entrada. Nota: tipo 'E', não cancelada,
   * finalidade normal (processada ou não, como no legado). Filtro de produto também pelo código do fornecedor (`X.CODPRODNOTA`).
   *
   * Redesenhado sobre o dado onde a conta do legado erra (recon 25/09/2026, produção):
   *  - "última nota" = a mais recente por data contábil (desempate pelo código), POR EMPRESA — o legado pega MAX(CODNF) para todas as
   *    empresas marcadas juntas: errado em 868 de 19.615 produtos (4,4%) na empresa 1, e some com o produto da loja se a última compra
   *    foi na outra;
   *  - "estoque na data de entrada" = o saldo que o kardex (HISTORICO_PROD) gravou naquela nota para o produto — o legado faz
   *    COALESCE(ESTOQUE_ATUAL − QTD_VENDIDA, 0): o sinal é o contrário (estoque na entrada = atual + vendido) e sem venda posterior dá 0;
   *  - "vendida desde" = a MOVIMENTACAO_DIARIA da MESMA empresa depois da data da nota — o legado soma todas as empresas marcadas e
   *    ainda soma de novo as NF de saída das mesmas CFOPs, que a MOVIMENTACAO_DIARIA já contém (a procedure do GIROS as inclui);
   *  - custo e fator da linha (o legado SOMA VRCUSTO e FATOREMBAL quando o produto aparece em duas linhas da mesma nota); a quantidade
   *    soma; o número da nota vai junto com o código interno (o .fr3 imprime o CODNF como "Ult.NroNF").
   */
  private async produtosFornecedor(db: AnyDB, f: FiltroProdutosRel2): Promise<ResultadoProdutosRel2> {
    const emps = await this.empresas(db, f.empresas);
    const onde: RawBuilder<unknown>[] = [...this.filtrosCadastro({ ...f, produto: null, codfor: null }, 'p'), ...(await this.filtroAtivo(f, 'p', 'm')),
      ...this.filtrosEstoqueAlias(f, 'e', 'de')];
    if (f.codfor) onde.push(sql`u.codparceiro = ${f.codfor}`);
    if (f.produto?.trim()) onde.push(sql`(i.codprodnota = ${f.produto.trim()} OR ${this.produto('p', f.produto)})`);
    const linhas = (await sql<Linha>`
      WITH u AS (
        SELECT DISTINCT ON (n.idempresa, np.codproduto)
               n.idempresa, np.codproduto, n.codnf, n.nronf, n.dtcontabil, n.codparceiro
          FROM nf n
          JOIN nf_prod np ON np.codnf = n.codnf
         WHERE n.idempresa IN (${sql.join(emps)}) AND n.tipo = 'E' AND n.cancelada = 'N' AND coalesce(n.finalidade, '1') = '1'
         ORDER BY n.idempresa, np.codproduto, n.dtcontabil DESC, n.codnf DESC),
      i AS (
        SELECT u.idempresa, u.codproduto, min(np.codprodnota) AS codprodnota, min(np.descricao) AS descricao_nf,
               sum(np.quantidade) AS ult_qtde, max(np.vrcusto) AS vrcusto, max(np.fatorembal) AS fatorembal
          FROM u JOIN nf_prod np ON np.codnf = u.codnf AND np.codproduto = u.codproduto
         GROUP BY u.idempresa, u.codproduto)
      SELECT u.codparceiro, coalesce(pa.fantasia, pa.razao) AS fantasia, u.idempresa, i.codprodnota, u.codproduto AS idproduto,
             p.codbarra, coalesce(i.descricao_nf, p.descricao) AS descricao, i.vrcusto, i.fatorembal,
             u.codnf AS ult_codnf, u.nronf AS ult_nronf, to_char(u.dtcontabil, 'YYYY-MM-DD') AS ult_data, i.ult_qtde,
             coalesce(e.qtde, 0) AS estoque_atual,
             (SELECT coalesce(sum(z.qtde), 0) FROM movimentacao_diaria z
               WHERE z.codproduto = u.codproduto AND z.idempresa = u.idempresa AND z.data > u.dtcontabil) AS qtd_vendida,
             (SELECT h.saldo_novo FROM historico_prod h
               WHERE h.codnf = u.codnf AND h.idproduto = u.codproduto AND h.idempresa = u.idempresa
               ORDER BY h.data DESC, h.codmov DESC LIMIT 1) AS estoque_dt_entrada
        FROM u
        JOIN i                   ON i.idempresa = u.idempresa AND i.codproduto = u.codproduto
        LEFT JOIN produtos p     ON p.idproduto = u.codproduto
        LEFT JOIN multi_preco m  ON m.idproduto = u.codproduto AND m.idempresa = u.idempresa
        LEFT JOIN estoque e      ON e.idproduto = u.codproduto AND e.idempresa = u.idempresa
        LEFT JOIN estoque_dep de ON de.idproduto = u.codproduto AND de.idempresa = u.idempresa
        LEFT JOIN parceiros pa   ON pa.codparceiro = u.codparceiro
       ${onde.length ? sql`WHERE ${sql.join(onde, sql` AND `)}` : sql``}
       ORDER BY fantasia, descricao
       LIMIT 20001`.execute(db)).rows;
    return { tipo: f.tipo, linhas, totais: { itens: linhas.length, fornecedores: new Set(linhas.map((l) => l.codparceiro)).size } };
  }
}
