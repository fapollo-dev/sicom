import { Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { relatorioMestre } from '../../shared/relatorios/relatorio-mestre';
import { hojeNaLoja } from '../../shared/tempo/hoje';

type AnyDB = Kysely<any>;
type Linha = Record<string, unknown>;

export type TipoDde = 'PADRAO' | 'RUPTURA';
export type SinalDde = 'MAIOR_IGUAL' | 'IGUAL' | 'MENOR_IGUAL';

export interface FiltroDde {
  /** o `cbbTipoRel`: "Dias de estoque" (`TDiasDeEstoquePadrao`) ou "Dias de estoque (ruptura)" (`TDiasDeEstoqueRuptura`) */
  tipo?: TipoDde | null;
  /** o `EdtDiasCalculoCobertura`: a janela de venda que dá a média diária */
  dias: number;
  /** a ruptura: `WHERE DDE.COBERTURA <sinal> <diasRuptura>` */
  diasRuptura?: number | null;
  sinal?: SinalDde | null;
  /** o `CkbFiltrarProdutosVendidos` — só no tipo padrão (na ruptura o legado o desmarca e esconde) */
  somenteVendidos?: boolean;
  idproduto?: number | null;
  coddpto?: number | null;
  codgrupo?: number | null;
  codsubgrupo?: number | null;
  codsecao?: number | null;
  codfor?: number | null;
  /** as lojas do `GetMultiEmpresa` (recortadas às do operador) */
  empresas?: number[] | null;
}

/** o `GetSinalOperador` (URelDDE.pas): 'Maior ou igual' → '>=', 'Igual a' → '=', o resto → '<=' */
const SINAL: Record<SinalDde, string> = { MAIOR_IGUAL: '>=', IGUAL: '=', MENOR_IGUAL: '<=' };

/**
 * DIAS DE ESTOQUE / COBERTURA (`FRMRELDDE`, `URelDDE.pas` + `uDDE.pas` + a grade `URelDDEGrid.pas`). Dossiê: `uRelDDE.md`. **133 acessos.**
 *
 * Responde a pergunta que decide a compra: **"com o que tenho na prateleira, quantos dias eu aguento?"** A venda vem de
 * `MOVIMENTACAO_DIARIA` (a consolidação por produto e dia — 4 milhões de linhas na produção, mig 220).
 *
 * ── `GetSQLBaseDiasEstoque` (uDDE.pas), linha a linha ───────────────────────────────────────────────────────────────────────────
 *  · `PROD_VENDIDOS`: produto × loja com venda desde `hoje − dias`, o estoque = `ESTOQUE + ESTOQUE_DEP` e a cobertura
 *    `CAST(CASE WHEN estoque < 0 THEN 0 WHEN vendido > 0 THEN estoque ÷ (vendido ÷ dias) ELSE −999999 END AS NUMBER(20))`.
 *    ⚠️ o `CAST(... AS NUMBER(20))` **arredonda** (Oracle da produção: 2,7 → 3, 2,5 → 3) — não trunca; o `numeric(20)` do PG idem;
 *  · sem o "só vendidos": `UNION ALL` com os que **não venderam** — estoque descontado do que está em troca (`GET_TROCAS_PRODUTO`, só
 *    neste ramo), venda 0 e cobertura **−999999**, que o layout e a grade escrevem "Sem vendas";
 *  · os filtros por código do `MontaFiltroSQL` (produto, departamento, grupo, subgrupo, seção, fornecedor — todos colunas de PRODUTOS)
 *    e as lojas, nos dois ramos; `ORDER BY DESCRICAO, IDPRODUTO, IDEMPRESA`.
 *
 * ── Os dois tipos ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *  · **padrão**: a base como está (`Dias_de_estoque_1_empresa.fr3`, ou `..._varias_empresas.fr3` quando as lojas têm vírgula);
 *  · **ruptura**: a base × `GET_PRODUTOS` (o preço da loja) × `GET_PARCEIROS` (o fornecedor principal), só `COBERTURA > 0` e
 *    `COBERTURA <sinal> <dias da ruptura>`, por loja e razão do fornecedor. A grade mostra fator de embalagem, custo e venda (o
 *    `GetSQLGrid`) com os fornecedores secundários (`CODREFERENCIA_FOR`) como detalhe; a impressão (`GetSQL`) traz um registro por
 *    fornecedor secundário, agrupado por fornecedor e produto (`Dias_de_estoque_ruptura.fr3`, 2 níveis).
 */
@Injectable()
export class RelDdeService {
  constructor(private readonly dbp: DatabaseProvider) {}

  /** o `Validacoes` (URelDDE.pas), com as mensagens dele */
  private validar(f: FiltroDde): { tipo: TipoDde; sinal: string; diasRuptura: number } {
    const tipo: TipoDde = f.tipo ?? 'PADRAO';
    if (!(f.dias > 0)) throw new BusinessRuleError('DDE_DIAS_INVALIDO', { dias: f.dias }, 'Informe a quantidade de dias para o cálculo da cobertura.');
    if (tipo === 'RUPTURA') {
      if (!(Number(f.diasRuptura) > 0)) throw new BusinessRuleError('DDE_DIAS_RUPTURA_INVALIDO', { diasRuptura: f.diasRuptura }, 'Informe a quantidade de dias para a ruptura');
      if (!f.sinal || !SINAL[f.sinal]) throw new BusinessRuleError('DDE_SINAL_INVALIDO', { sinal: f.sinal }, 'Informe o sinal de operação para a condição de ruptura');
      return { tipo, sinal: SINAL[f.sinal], diasRuptura: Math.trunc(Number(f.diasRuptura)) };
    }
    return { tipo, sinal: '', diasRuptura: 0 };
  }

  /** o `GetSQLBaseDiasEstoque`, sem o ORDER BY (quem chama ordena) */
  private base(f: FiltroDde, empresas: number[], somenteVendidos: boolean): RawBuilder<unknown> {
    const dias = Math.trunc(f.dias);
    const filtros: RawBuilder<unknown>[] = [];
    if (f.idproduto) filtros.push(sql`AND p.idproduto = ${f.idproduto}`);
    if (f.coddpto) filtros.push(sql`AND p.coddpto = ${f.coddpto}`);
    if (f.codgrupo) filtros.push(sql`AND p.codgrupo = ${f.codgrupo}`);
    if (f.codsubgrupo) filtros.push(sql`AND p.codsubgrupo = ${f.codsubgrupo}`);
    if (f.codsecao) filtros.push(sql`AND p.codsecao = ${f.codsecao}`);
    if (f.codfor) filtros.push(sql`AND p.codfor = ${f.codfor}`);
    const filtroProd = filtros.length ? sql.join(filtros, sql` `) : sql``;
    const naoVendidos = somenteVendidos ? sql`` : sql`
        SELECT p.idproduto, e.idempresa, p.codbarra, p.descricao,
               (coalesce(e.qtde, 0) + coalesce(ed.qtde, 0) - coalesce(t.quantidade, 0)) AS qtde_estoque,
               0::numeric AS qtde_vendida, (-999999)::numeric AS cobertura, emp.fantasia, emp.razao_social AS razaosocial
          FROM produtos p
          JOIN estoque e                  ON e.idproduto = p.idproduto
          LEFT JOIN estoque_dep ed        ON ed.idproduto = p.idproduto AND ed.idempresa = e.idempresa
          LEFT JOIN get_trocas_produto t  ON t.codigo = p.idproduto AND t.empresa = e.idempresa
          JOIN empresas emp               ON emp.idempresa = e.idempresa
         WHERE NOT EXISTS (SELECT 1 FROM prod_vendidos pv WHERE pv.idproduto = p.idproduto AND pv.idempresa = e.idempresa)
           ${filtroProd}
           AND e.idempresa = ANY(${empresas})
        UNION ALL`;
    return sql`
      WITH prod_vendidos AS (
        SELECT v.idproduto, v.idempresa, v.codbarra, v.descricao, v.qtde_estoque, v.qtde_vendida,
               (CASE WHEN v.qtde_estoque < 0 THEN 0
                     WHEN v.qtde_vendida > 0 AND ${dias}::int > 0 THEN v.qtde_estoque / (v.qtde_vendida / ${dias}::numeric)
                     ELSE -999999 END)::numeric(20) AS cobertura
          FROM (SELECT p.idproduto, m.idempresa, p.codbarra, p.descricao,
                       (coalesce(e.qtde, 0) + coalesce(ed.qtde, 0)) AS qtde_estoque,
                       sum(m.qtde) AS qtde_vendida
                  FROM produtos p
                  JOIN estoque e             ON e.idproduto = p.idproduto
                  LEFT JOIN estoque_dep ed   ON ed.idproduto = p.idproduto AND ed.idempresa = e.idempresa
                  JOIN movimentacao_diaria m ON m.idempresa = e.idempresa AND m.codproduto = e.idproduto
                 WHERE m.data >= ${hojeNaLoja()}::date - ${dias}::int
                   ${filtroProd}
                   AND m.idempresa = ANY(${empresas})
                 GROUP BY p.idproduto, m.idempresa, p.codbarra, p.descricao, (coalesce(e.qtde, 0) + coalesce(ed.qtde, 0))) v
      )
      SELECT * FROM (${naoVendidos}
        SELECT pv.idproduto, pv.idempresa, pv.codbarra, pv.descricao, pv.qtde_estoque, pv.qtde_vendida, pv.cobertura,
               emp.fantasia, emp.razao_social AS razaosocial
          FROM prod_vendidos pv
          JOIN empresas emp ON emp.idempresa = pv.idempresa) dde`;
  }

  private numeros(linhas: Linha[]): Linha[] {
    const NUM = ['qtde_estoque', 'qtde_vendida', 'cobertura', 'fatorembal', 'vrcusto', 'vrvenda'];
    return linhas.map((l) => {
      const o = { ...l };
      for (const k of NUM) if (k in o && o[k] != null) o[k] = Number(o[k]);
      return o;
    });
  }

  /** o tipo padrão: a base, como o `GetSQL` do `TDiasDeEstoquePadrao` (e a grade, que é o mesmo SQL) */
  private async padrao(db: AnyDB, f: FiltroDde, empresas: number[]): Promise<Linha[]> {
    const b = this.base(f, empresas, f.somenteVendidos === true);
    return this.numeros((await sql<Linha>`
      SELECT * FROM (${b}) x ORDER BY x.descricao, x.idproduto, x.idempresa`.execute(db)).rows);
  }

  /**
   * a ruptura: a base (sem o "só vendidos" — o legado o desmarca) × o preço da loja × o fornecedor principal. `GET_PRODUTOS` é
   * `MULTI_PRECO ⟕ PRODUTOS` e `GET_PARCEIROS` é `PARCEIROS ⟕ PARCEIROS_END` (uma linha por endereço, que o GROUP BY do legado
   * colapsa) — aqui as tabelas direto, com a mesma semântica.
   */
  private rupturaFrom(f: FiltroDde, empresas: number[], sinal: string, diasRuptura: number, juntar: RawBuilder<unknown> = sql``): RawBuilder<unknown> {
    return sql`
        FROM (${this.base(f, empresas, false)}) dde
        JOIN multi_preco mp ON mp.idproduto = dde.idproduto AND mp.idempresa = dde.idempresa
        JOIN produtos prod  ON prod.idproduto = mp.idproduto
        JOIN parceiros parc ON parc.codparceiro = prod.codfor
        ${juntar}
       WHERE dde.cobertura ${sql.raw(sinal)} ${diasRuptura}::int
         AND dde.idempresa = ANY(${empresas})
         AND dde.cobertura > 0`;
  }

  /** o `GetSQLGrid` da ruptura: o que a grade mostra (com fator de embalagem, custo e venda) */
  private async rupturaGrade(db: AnyDB, f: FiltroDde, empresas: number[], sinal: string, diasRuptura: number) {
    const linhas = this.numeros((await sql<Linha>`
      SELECT parc.codparceiro AS codfor, parc.razao AS fornecedor, dde.idempresa, prod.idproduto, prod.codbarra, prod.descricao,
             dde.qtde_estoque, dde.qtde_vendida, dde.cobertura, dde.fantasia, dde.razaosocial,
             CASE prod.unidade WHEN 'KG' THEN prod.fatorkg ELSE prod.fatorcx END AS fatorembal,
             mp.vrcusto, mp.vrvenda
        ${this.rupturaFrom(f, empresas, sinal, diasRuptura)}
       GROUP BY dde.idempresa, parc.codparceiro, prod.idproduto, prod.codbarra, parc.razao, prod.descricao, dde.qtde_estoque, dde.qtde_vendida,
                dde.cobertura, dde.fantasia, dde.razaosocial, mp.vrcusto, mp.vrvenda, prod.unidade, prod.fatorkg, prod.fatorcx
       ORDER BY dde.idempresa, parc.razao`.execute(db)).rows);
    // o `GetSQLAuxiliarGrid`: os fornecedores secundários (CODREFERENCIA_FOR), o detalhe de cada produto da grade
    const ids = [...new Set(linhas.map((l) => Number(l.idproduto)))];
    const secundarios = ids.length ? (await sql<Linha>`
      SELECT c.idproduto, c.codfor AS codfor_sec, p.razao AS fornecedor_secundario
        FROM codreferencia_for c
        LEFT JOIN parceiros p ON p.codparceiro = c.codfor AND p.frn = 'S'
       WHERE c.idproduto = ANY(${ids})
       GROUP BY c.idproduto, c.codfor, p.razao
       ORDER BY c.idproduto, c.codfor`.execute(db)).rows : [];
    return { linhas, secundarios };
  }

  /** o `GetSQL` da ruptura: o que a impressão recebe — um registro por fornecedor secundário */
  private async rupturaRelatorio(db: AnyDB, f: FiltroDde, empresas: number[], sinal: string, diasRuptura: number): Promise<Linha[]> {
    return this.numeros((await sql<Linha>`
      SELECT parc.codparceiro AS codfor, parc.razao AS fornecedor, dde.idempresa, prod.idproduto, prod.codbarra, prod.descricao,
             dde.qtde_estoque, dde.qtde_vendida, dde.cobertura, dde.fantasia, dde.razaosocial,
             for_sec.codfor_sec, for_sec.fornecedor_secundario
        ${this.rupturaFrom(f, empresas, sinal, diasRuptura, sql`
        LEFT JOIN (SELECT c.codreferencia_for, c.idproduto, c.codfor AS codfor_sec, p.razao AS fornecedor_secundario
                     FROM codreferencia_for c
                     LEFT JOIN parceiros p ON p.codparceiro = c.codfor AND p.frn = 'S') for_sec ON for_sec.idproduto = dde.idproduto`)}
       GROUP BY dde.idempresa, parc.codparceiro, prod.idproduto, prod.codbarra, parc.razao, prod.descricao, dde.qtde_estoque, dde.qtde_vendida,
                dde.cobertura, dde.fantasia, dde.razaosocial, for_sec.codfor_sec, for_sec.fornecedor_secundario
       ORDER BY dde.idempresa, parc.razao, for_sec.codfor_sec`.execute(db)).rows);
  }

  /** a consulta da tela: a grade do `TFrmRelDDEGrid` */
  async gerar(f: FiltroDde): Promise<{ tipo: TipoDde; dias: number; empresas: number[]; linhas: Linha[]; secundarios: Linha[] }> {
    const { tipo, sinal, diasRuptura } = this.validar(f);
    const db = this.dbp.forTenantRead() as AnyDB;
    const empresas = await empresasDoOperador(db, f.empresas ?? null);
    if (tipo === 'RUPTURA') {
      const g = await this.rupturaGrade(db, f, empresas, sinal, diasRuptura);
      return { tipo, dias: f.dias, empresas, ...g };
    }
    return { tipo, dias: f.dias, empresas, linhas: await this.padrao(db, f, empresas), secundarios: [] };
  }

  /**
   * A impressão (`TFrmRelMaster.GeraRelatorio` com o `NomeRelatorio` da classe): o padrão em `Dias_de_estoque_1_empresa.fr3` — ou
   * `Dias_de_estoque_varias_empresas.fr3` quando o `Empresas` tem vírgula (`SetaRelatorioVariasEmpresas`) —, a ruptura em
   * `Dias_de_estoque_ruptura.fr3` com os níveis expandidos (fornecedor ≥ 1, produto = 2; padrão 0).
   */
  async impressao(f: FiltroDde, niveis?: number | null) {
    const { tipo, sinal, diasRuptura } = this.validar(f);
    const db = this.dbp.forTenantRead() as AnyDB;
    const empresas = await empresasDoOperador(db, f.empresas ?? null);
    const hoje = hojeNaLoja();
    if (tipo === 'RUPTURA') {
      return relatorioMestre(db, {
        arquivo: 'Dias_de_estoque_ruptura.fr3', titulo: 'Dias de estoque (ruptura)',
        relatorio: await this.rupturaRelatorio(db, f, empresas, sinal, diasRuptura),
        variaveis: { empresas, dataIni: hoje, dataFim: hoje, niveis: niveis ?? 0 },
      });
    }
    const arquivo = empresas.length > 1 ? 'Dias_de_estoque_varias_empresas.fr3' : 'Dias_de_estoque_1_empresa.fr3';
    return relatorioMestre(db, {
      arquivo, titulo: 'Dias de estoque', relatorio: await this.padrao(db, f, empresas),
      variaveis: { empresas, dataIni: hoje, dataFim: hoje, niveis: 0 },
    });
  }
}
