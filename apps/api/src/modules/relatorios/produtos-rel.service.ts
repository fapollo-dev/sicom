import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** os três do corte-1 — os que compartilham o núcleo de estoque. */
export type TipoProdutosRel = 'ESTOQUE_ATUAL' | 'RUPTURA' | 'ANALISE';

/**
 * O `cmbFiltro` do legado: quinze comparações entre a quantidade em estoque e o mínimo/máximo do produto.
 * A ordem é a do combo, e os nomes foram mantidos para o operador reconhecer.
 */
export type FiltroEstoque =
  | 'TODOS'
  | 'MENOR_IGUAL_MINIMO' | 'MENOR_MINIMO' | 'MAIOR_IGUAL_MINIMO' | 'MAIOR_MINIMO' | 'IGUAL_MINIMO'
  | 'MENOR_IGUAL_MAXIMO' | 'MENOR_MAXIMO' | 'MAIOR_IGUAL_MAXIMO' | 'MAIOR_MAXIMO' | 'IGUAL_MAXIMO'
  | 'NEGATIVA' | 'ZERADA' | 'MAIOR_ZERO' | 'NEGATIVA_OU_ZERADA';

export interface FiltroProdutosRel {
  tipo: TipoProdutosRel;
  filtroEstoque?: FiltroEstoque | null;
  ativo?: 'S' | 'N' | null;
  coddpto?: number | null;
  codgrupo?: number | null;
  codsubgrupo?: number | null;
  codsecao?: number | null;
  codfor?: number | null;
  produto?: string | null;
  /** RUPTURA: dias sem venda que caracterizam a falta. O legado usa a data da última venda. */
  diasSemVenda?: number | null;
}

/**
 * RELATÓRIOS DE PRODUTOS (`FRMPRODUTOSREL`). Dossiê: `uProdutosRel.md`. **162 acessos, 19 operadores.**
 *
 * ⚠️ **A tela é um épico**: ~10.900 linhas de fonte e **15 relatórios** num combo só, servidos por 21
 * datasets. Este é o **corte-1**, com os três que compartilham o mesmo núcleo — a posição de estoque:
 *  · **Estoque atual** — quanto tem, contra mínimo e máximo;
 *  · **Ruptura na loja** — o que zerou ou ficou negativo, e há quantos dias não vende;
 *  · **Relatório para análise** — estoque com preço, custo e a margem de cada item.
 *
 * ── ⚠️ A escolha da tabela decide se o relatório mostra tudo zero ─────────────────────────────────────
 * O legado tem duas tabelas gêmeas de estoque, com as mesmas colunas:
 *  · `ESTOQUE_DEP` está **completamente zerada** neste cliente — 203.546 linhas sem quantidade, sem mínimo,
 *    sem máximo e sem local: ele **não usa estoque por depósito**;
 *  · `ESTOQUE` é onde o número está: **4.121 produtos com estoque negativo** e 186.487 zerados.
 * Medido na produção em 14/09/2026. Lemos `ESTOQUE`.
 *
 * ⚠️ **mínimo e máximo quase não são usados**: 4 produtos com mínimo e 2 com máximo, em 203.546. As dez
 * comparações do combo que dependem deles vão devolver quase nada — e isso é do cadastro do cliente, não do
 * relatório. As que valem aqui são as quatro de sinal (negativa, zerada, maior que zero, negativa ou zerada),
 * e é por isso que a ruptura é o corte que interessa.
 */
@Injectable()
export class ProdutosRelService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** as quinze comparações do `cmbFiltro`, uma a uma, na ordem do combo. */
  private comparacao(f: FiltroEstoque) {
    const q = sql`coalesce(e.qtde, 0)`;
    const mi = sql`coalesce(e.minimo, 0)`;
    const ma = sql`coalesce(e.maximo, 0)`;
    switch (f) {
      case 'MENOR_IGUAL_MINIMO':  return sql`${q} <= ${mi}`;
      case 'MENOR_MINIMO':        return sql`${q} <  ${mi}`;
      case 'MAIOR_IGUAL_MINIMO':  return sql`${q} >= ${mi}`;
      case 'MAIOR_MINIMO':        return sql`${q} >  ${mi}`;
      case 'IGUAL_MINIMO':        return sql`${q} =  ${mi}`;
      case 'MENOR_IGUAL_MAXIMO':  return sql`${q} <= ${ma}`;
      case 'MENOR_MAXIMO':        return sql`${q} <  ${ma}`;
      case 'MAIOR_IGUAL_MAXIMO':  return sql`${q} >= ${ma}`;
      case 'MAIOR_MAXIMO':        return sql`${q} >  ${ma}`;
      case 'IGUAL_MAXIMO':        return sql`${q} =  ${ma}`;
      case 'NEGATIVA':            return sql`${q} <  0`;
      case 'ZERADA':              return sql`${q} =  0`;
      case 'MAIOR_ZERO':          return sql`${q} >  0`;
      case 'NEGATIVA_OU_ZERADA':  return sql`${q} <= 0`;
      default:                    return null;
    }
  }

  async gerar(f: FiltroProdutosRel): Promise<{
    tipo: TipoProdutosRel;
    linhas: Array<Record<string, unknown>>;
    totais: { itens: number; qtdeTotal: number; valorCusto: number; valorVenda: number; negativos: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;

    const onde = [sql`e.idempresa = ${emp}`];
    // 'ativo' é do CADASTRO do produto, não do estoque
    if (f.ativo) onde.push(sql`coalesce(pr.ativo, 'S') = ${f.ativo}`);
    if (f.coddpto) onde.push(sql`pr.coddpto = ${f.coddpto}`);
    if (f.codgrupo) onde.push(sql`pr.codgrupo = ${f.codgrupo}`);
    if (f.codsubgrupo) onde.push(sql`pr.codsubgrupo = ${f.codsubgrupo}`);
    if (f.codsecao) onde.push(sql`pr.codsecao = ${f.codsecao}`);
    if (f.codfor) onde.push(sql`pr.codfor = ${f.codfor}`);
    if (f.produto) onde.push(sql`(pr.descricao ILIKE ${`%${f.produto}%`} OR pr.codbarra = ${f.produto})`);

    const cmp = this.comparacao(f.filtroEstoque ?? 'TODOS');
    if (cmp) onde.push(cmp);

    // a RUPTURA é o que zerou ou ficou negativo — e o legado mede há quanto tempo não vende
    if (f.tipo === 'RUPTURA') {
      onde.push(sql`coalesce(e.qtde, 0) <= 0`);
      if (f.diasSemVenda != null) {
        onde.push(sql`(e.dtvenda IS NULL OR e.dtvenda < current_date - ${f.diasSemVenda}::int)`);
      }
    }

    const linhas = (await sql<Record<string, unknown>>`
      SELECT pr.idproduto, pr.codbarra, pr.descricao, coalesce(pr.ativo, 'S') AS ativo, pr.unidade,
             d.descricao AS departamento, g.descricao AS grupo,
             sg.descricao AS subgrupo, sc.descricao AS secao,
             pa.razao AS fornecedor,
             coalesce(e.qtde, 0)   AS qtde,
             coalesce(e.minimo, 0) AS minimo,
             coalesce(e.maximo, 0) AS maximo,
             e.local,
             coalesce(e.qtde_est_ped_vendas, 0)  AS reservado_venda,
             coalesce(e.qtde_est_ped_compras, 0) AS pedido_compra,
             coalesce(e.qtde_cong, 0) AS congelado,
             to_char(e.dtvenda, 'YYYY-MM-DD') AS ultima_venda,
             -- quantos dias sem vender: é o número que decide se a falta é ruptura ou item morto
             CASE WHEN e.dtvenda IS NULL THEN NULL
                  ELSE (current_date - e.dtvenda::date) END AS dias_sem_venda,
             coalesce(m.vrcusto, 0) AS vrcusto,
             coalesce(m.vrvenda, 0) AS vrvenda,
             -- o valor parado na prateleira, pelos dois lados
             round((coalesce(e.qtde, 0) * coalesce(m.vrcusto, 0))::numeric, 2) AS valor_custo,
             round((coalesce(e.qtde, 0) * coalesce(m.vrvenda, 0))::numeric, 2) AS valor_venda,
             -- a margem do item, como percentual sobre a venda (nula quando não há preço)
             CASE WHEN coalesce(m.vrvenda, 0) > 0
                  THEN round((((m.vrvenda - coalesce(m.vrcusto, 0)) / m.vrvenda) * 100)::numeric, 2)
                  END AS margem
        FROM estoque e
        JOIN produtos pr           ON pr.idproduto = e.idproduto
        LEFT JOIN multi_preco m    ON m.idproduto = e.idproduto AND m.idempresa = e.idempresa
        LEFT JOIN familias_prod d  ON d.codfamilia = pr.coddpto     AND d.tipo  = 'D'
        LEFT JOIN familias_prod g  ON g.codfamilia = pr.codgrupo    AND g.tipo  = 'G'
        LEFT JOIN familias_prod sg ON sg.codfamilia = pr.codsubgrupo AND sg.tipo = 'S'
        LEFT JOIN familias_prod sc ON sc.codfamilia = pr.codsecao    AND sc.tipo = 'O'
        LEFT JOIN parceiros pa     ON pa.codparceiro = pr.codfor
       WHERE ${sql.join(onde, sql` AND `)}
       ORDER BY ${f.tipo === 'RUPTURA' ? sql`coalesce(e.qtde, 0), pr.descricao` : sql`pr.descricao`}
       LIMIT 20001
    `.execute(db)).rows;

    return {
      tipo: f.tipo,
      linhas,
      totais: {
        itens: linhas.length,
        qtdeTotal: r2(linhas.reduce((s, l) => s + num(l.qtde), 0)),
        valorCusto: r2(linhas.reduce((s, l) => s + num(l.valor_custo), 0)),
        valorVenda: r2(linhas.reduce((s, l) => s + num(l.valor_venda), 0)),
        negativos: linhas.filter((l) => num(l.qtde) < 0).length,
      },
    };
  }
}
