import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroInterseccao {
  idproduto: number;
  dataIni: string;
  dataFim: string;
  /** a ordenação do legado: por quantidade vendida ou por número de cupons. */
  ordenarPor?: 'QTDE' | 'CUPOM' | null;
  /** o "Qtde itens analisados" da tela: quantas linhas trazer. */
  limite?: number | null;
}

/**
 * INTERSECÇÃO DE PRODUTOS (`FRMRELINTERSECCAOPRODUTOS`, `uRelInterseccaoProdutos.pas`).
 * Dossiê: `uRelInterseccaoProdutos.md`. **117 acessos, 10 operadores.**
 *
 * **O que mais o cliente leva quando leva este produto.** Análise de cesta: acha os cupons que contêm o
 * produto escolhido e soma tudo o que estava junto neles. É o relatório que diz onde pôr a gôndola do
 * amaciante em relação à do sabão em pó.
 *
 * ── ⚠️ O legado usa uma TABELA DE TRABALHO GLOBAL, e dois operadores se atropelam ─────────────────────
 * O fluxo original (`:150-195`) é em três passos: acha os cupons do produto → **grava os códigos na tabela
 * `VENDAS_INTER`, depois de um `DELETE FROM VENDAS_INTER` sem filtro nenhum** → soma os itens desses cupons
 * fazendo join com ela.
 *
 * A tabela é física e global: **se dois operadores rodam o relatório ao mesmo tempo, o segundo apaga os
 * cupons do primeiro** e ambos recebem resultado errado, sem erro na tela. Com 10 operadores usando a tela,
 * isso não é hipótese remota — e numa aplicação web, com todo mundo no mesmo servidor, seria a regra.
 *
 * Aqui é **uma consulta só**, com os cupons num CTE. Não há tabela intermediária, não há `DELETE`, não há
 * corrida. O resultado é o mesmo; o que muda é que ele continua certo com gente simultânea.
 *
 * ⚠️ o próprio produto pesquisado é **excluído** do resultado (`cdsVendas_Inter.Filter`, `:196`) — ele está
 * em 100% dos cupons por definição, e ocuparia o topo de toda lista sem dizer nada.
 *
 * ── ⚠️ O CUPOM é `codvendas_legado`, não `codvendas` ─────────────────────────────────────────────────
 * No Oracle, `VENDAS.CODVENDAS` identifica o **cupom** — 23.518 cupons para 103.041 linhas em setembro/2026,
 * 4,4 itens por cupom. No destino ele não podia ser a PK (a carga precisa de uma chave por LINHA), então o
 * ETL o renomeia para **`codvendas_legado`** e gera um `codvendas` novo por item.
 *
 * Agrupar por `codvendas` aqui daria **um "cupom" por item** — a análise de cesta não encontraria
 * companhia nenhuma e o relatório voltaria sempre vazio, sem erro. A conta usa `codvendas_legado`.
 *
 * ⚠️ o valor é `SUM(QTDE × VRVENDA)`. O SQL guardado no `.dfm` traz `SUM(VRVENDA)` — sem a quantidade —, mas
 * é o texto montado no `.pas` que roda de verdade, e ele multiplica. O do `.dfm` é resíduo de uma versão
 * anterior; copiar de lá daria o valor errado em todo item vendido em quantidade maior que 1.
 */
@Injectable()
export class RelInterseccaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: FiltroInterseccao): Promise<{
    produto: Record<string, unknown> | null;
    linhas: Array<Record<string, unknown>>;
    totais: { cupons: number; qtdeProduto: number; itensRelacionados: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    if (f.dataIni > f.dataFim) throw new BusinessRuleError('DATA_INICIAL_MAIOR', { dataIni: f.dataIni, dataFim: f.dataFim });
    const limite = f.limite && f.limite > 0 ? Math.min(f.limite, 5000) : 200;

    const prod = (await sql<Record<string, unknown>>`
      SELECT idproduto, codbarra, descricao, unidade FROM produtos WHERE idproduto = ${f.idproduto}
    `.execute(db)).rows[0] ?? null;
    if (!prod) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: f.idproduto });

    const linhas = (await sql<Record<string, unknown>>`
      WITH cupons AS (
        -- os cupons que levaram o produto: é o recorte que o legado gravava em VENDAS_INTER
        SELECT DISTINCT v.codvendas_legado, sum(v.qtde) OVER () AS qtde_produto
          FROM vendas v
         WHERE v.codproduto = ${f.idproduto}
           AND v.idempresa = ${emp}
           AND v.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           AND coalesce(v.cancelado, 'N') = 'N'
      )
      SELECT b.codproduto, p.codbarra, p.descricao, p.unidade,
             sum(b.qtde) AS qtde,
             -- ⚠️ quantidade VEZES preço: o dfm guarda a versão sem a quantidade, que é resíduo
             round(sum(b.qtde * b.vrvenda)::numeric, 2) AS vrvenda,
             count(DISTINCT b.codvendas_legado)::numeric(13,2) AS qtdecupom,
             -- em quantos por cento dos cupons do produto este item apareceu junto
             round((count(DISTINCT b.codvendas_legado)::numeric
                    / nullif((SELECT count(*) FROM cupons), 0) * 100), 2) AS pct_cupons
        FROM cupons c
        JOIN vendas b         ON b.codvendas_legado = c.codvendas_legado
        LEFT JOIN produtos p  ON p.idproduto = b.codproduto
       WHERE coalesce(b.cancelado, 'N') = 'N'
         -- o próprio produto sai: está em 100% dos cupons e ocuparia o topo sem dizer nada
         AND b.codproduto <> ${f.idproduto}
       GROUP BY b.codproduto, p.codbarra, p.descricao, p.unidade
       ORDER BY ${f.ordenarPor === 'CUPOM' ? sql`count(DISTINCT b.codvendas_legado)` : sql`sum(b.qtde)`} DESC
       LIMIT ${limite}
    `.execute(db)).rows;

    const cab = (await sql<{ cupons: number; qtde: number }>`
      SELECT count(DISTINCT v.codvendas_legado)::int AS cupons, coalesce(sum(v.qtde), 0) AS qtde
        FROM vendas v
       WHERE v.codproduto = ${f.idproduto}
         AND v.idempresa = ${emp}
         AND v.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         AND coalesce(v.cancelado, 'N') = 'N'
    `.execute(db)).rows[0];

    return {
      produto: prod,
      linhas,
      totais: {
        cupons: Number(cab?.cupons ?? 0),
        qtdeProduto: r2(num(cab?.qtde)),
        itensRelacionados: linhas.length,
      },
    };
  }
}
