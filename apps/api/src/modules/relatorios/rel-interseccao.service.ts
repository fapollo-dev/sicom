import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

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
  /** as lojas do `TrocarEmpresa(true)` (recortadas às do operador; vazio = a do login) */
  empresas?: number[] | null;
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

    // as lojas escolhidas (o `TrocarEmpresa(true)` → `cdsMultiEmpresa`), recortadas às do operador; sem escolha, a do login
    const emps = f.empresas?.length ? await empresasDoOperador(db, f.empresas) : [emp];
    const dia = sql`cast(v.dtvenda at time zone 'America/Sao_Paulo' as date)`;
    // o fonte NÃO filtra item cancelado em nenhuma das duas consultas (o `sqqVendas` e o `cdsVendas_Inter`, :150-195)
    const linhas = (await sql<Record<string, unknown>>`
      WITH cupons AS (
        -- os cupons que levaram o produto (o sqqVendas: GROUP BY CODVENDAS) — o recorte que o legado gravava em VENDAS_INTER
        SELECT v.codvendas_legado, sum(v.qtde) AS qtde
          FROM vendas v
         WHERE ${dia} BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           AND v.codproduto = ${f.idproduto} AND v.idempresa = ANY(${emps})
         GROUP BY v.codvendas_legado
      )
      SELECT sum(b.qtde) AS qtde, sum(b.qtde * b.vrvenda) AS vrvenda, b.codproduto, p.codbarra, p.descricao, p.unidade,
             -- QTDECUPOM = CAST(COUNT(B.NROCUPOM) AS NUMERIC(13,2)): as LINHAS do item nesses cupons (o item duas vezes no cupom conta 2)
             count(b.nrocupom)::numeric(13,2) AS qtdecupom,
             -- em quantos por cento dos cupons do produto este item apareceu junto (informativo da grade; não vai para a impressão)
             round((count(DISTINCT b.codvendas_legado)::numeric / nullif((SELECT count(*) FROM cupons), 0) * 100), 2) AS pct_cupons
        FROM cupons c
        JOIN vendas b         ON b.codvendas_legado = c.codvendas_legado
        LEFT JOIN produtos p  ON p.idproduto = b.codproduto
       WHERE b.idempresa = ANY(${emps})
         -- o próprio produto sai (o Filter CODPRODUTO <> … do cdsVendas_Inter)
         AND b.codproduto <> ${f.idproduto}
       GROUP BY b.codproduto, p.codbarra, p.descricao, p.unidade
       -- o índice do cds (Indice_Qtde / Indice_QtdeCupom, descendentes) e o RangeEndCount = "Qtde itens analisados"
       ORDER BY ${f.ordenarPor === 'CUPOM' ? sql`count(b.nrocupom)` : sql`sum(b.qtde)`} DESC
       LIMIT ${limite}
    `.execute(db)).rows;

    // QtdeVendida e QtdeCupom do laço do `sqqVendas`: a soma da quantidade e o número de cupons
    const cab = (await sql<{ cupons: number; qtde: number }>`
      SELECT count(*)::int AS cupons, coalesce(sum(qtde), 0) AS qtde FROM (
        SELECT v.codvendas_legado, sum(v.qtde) AS qtde FROM vendas v
         WHERE ${dia} BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           AND v.codproduto = ${f.idproduto} AND v.idempresa = ANY(${emps})
         GROUP BY v.codvendas_legado) x
    `.execute(db)).rows[0];

    return {
      produto: prod,
      linhas,
      totais: {
        cupons: Number(cab?.cupons ?? 0),
        qtdeProduto: num(cab?.qtde),
        itensRelacionados: linhas.length,
      },
    };
  }

  /**
   * A IMPRESSÃO (`btnPesquisarClick`, :232-271): `extr - Interseccao produtos qtde vendida.fr3` (frxDBDtsProdQtdeVendida) ou
   * `... qtde cupom.fr3` (frxDBDtsQtdeCupom) pelo tipo de análise, com as N primeiras linhas (o RangeEndCount); variáveis DtIncial/DtFinal
   * (o texto das datas), CODBARRA/DESCRICAO/UNIDADE do produto, QTDE (`FormatFloat('0.000')`) e QTDE_CUPOM (`FormatFloat('0')`).
   * Sem linhas: "Não existe dados para esta pesquisa. Verifique!".
   */
  async impressao(f: FiltroInterseccao) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = await this.gerar(f);
    if (!r.linhas.length) throw new BusinessRuleError('INTERSECCAO_SEM_DADOS', {}, 'Não existe dados para esta pesquisa. Verifique!');
    const porCupom = f.ordenarPor === 'CUPOM';
    const ds = porCupom ? 'frxDBDtsQtdeCupom' : 'frxDBDtsProdQtdeVendida';
    const p = r.produto ?? {};
    const br = (d: string) => d.slice(0, 10).split('-').reverse().join('/');
    return {
      titulo: `Intersecção de produtos — ${String(p.descricao ?? '')}`,
      modelo: await modeloFr3(db, porCupom ? 'extr - Interseccao produtos qtde cupom.fr3' : 'extr - Interseccao produtos qtde vendida.fr3'),
      datasets: { [ds]: r.linhas.map((l) => registroFr3(l, new Set(['qtde', 'vrvenda', 'codproduto', 'qtdecupom', 'pct_cupons']))) },
      variaveis: {
        DtIncial: textoVariavel(br(f.dataIni)), DtFinal: textoVariavel(br(f.dataFim)),
        CODBARRA: textoVariavel(String(p.codbarra ?? '')), DESCRICAO: textoVariavel(String(p.descricao ?? '')), UNIDADE: textoVariavel(String(p.unidade ?? '')),
        QTDE: textoVariavel(r.totais.qtdeProduto.toFixed(3).replace('.', ',')), QTDE_CUPOM: textoVariavel(String(r.totais.cupons)),
      },
    };
  }
}
