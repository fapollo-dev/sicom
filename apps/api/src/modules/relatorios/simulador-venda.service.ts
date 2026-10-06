import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { SimuladorVendaDto, SimuladorVendaImpressaoDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { todasAsEmpresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloEmbutido } from '../../shared/relatorios/modelo-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * SIMULADOR DE VENDAS (`FRMSIMULADORVENDA`, `uSimuladorVenda.pas` 252 + `udmSimuladorVenda`). **42 acessos, 5 operadores.**
 * Dossiê: `uSimuladorVenda.md`. Migration 239.
 *
 * Refeito pelo fonte em 06/10/2026. O `sqqVendas`, coluna a coluna:
 *  - por produto (`GROUP BY CODPRODUTO, DESCRICAO, CODBARRA`, `ORDER BY DESCRICAO`), o período por `TRUNC(DTVENDA)`, sem o cancelado;
 *  - VRVENDA e VRCUSTO = a MÉDIA (`CAST(AVG(..) AS NUMERIC(18,2))`); QTDE = a soma;
 *  - TOTAL_CUSTO = Σ `CAST(QTDE × VRCUSTO AS NUMERIC(18,2))` (arredonda); SUB_TOTAL_VENDA = Σ `TRUNC(QTDE × VRVENDA × 100) / 100`
 *    (trunca) — a assimetria é do legado;
 *  - ACRÉSCIMO = a parte positiva de DESC_ACRE_MEDIO e DESC_ACRE_ITEM; DESCONTO = DESC_PROMOCAO + DESC_DEPARTAMENTO + a parte negativa
 *    deles, em módulo; TOTAL_VENDA = subtotal + acréscimo − desconto; LUCRO_TOTAL = `CAST(TOTAL_VENDA − TOTAL_CUSTO AS NUMERIC(13,2))`.
 * ⚠️ **o SQL não filtra loja nenhuma** — soma o banco inteiro (em agosto/2026: R$ 2,23 mi, as duas lojas). O Apollo soma todas as lojas
 * que o operador alcança (a do login + RELACAO_OPERADOR_EMPRESA) — para quem enxerga todas, é o número do legado. O campo "Descrição"
 * da tela não filtra (é um `Locate`) e não há limite de linhas: o corte 1 tinha filtro de produto, LIMIT 3000 e só a loja do login.
 * A simulação (editar venda, custo, quantidade, desconto e acréscimo) é da tela, como no `cdsVendas`; o Imprimir recebe a grade como está.
 */
@Injectable()
export class SimuladorVendaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  async gerar(f: SimuladorVendaDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emps = await todasAsEmpresasDoOperador(db);
    const acre = sql`(CASE WHEN coalesce(v.desc_acre_medio, 0) > 0 THEN coalesce(v.desc_acre_medio, 0) ELSE 0 END
                    + CASE WHEN coalesce(v.desc_acre_item, 0) > 0 THEN coalesce(v.desc_acre_item, 0) ELSE 0 END)`;
    const desc = sql`(coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
                    + CASE WHEN coalesce(v.desc_acre_medio, 0) < 0 THEN coalesce(v.desc_acre_medio, 0) * -1 ELSE 0 END
                    + CASE WHEN coalesce(v.desc_acre_item, 0) < 0 THEN coalesce(v.desc_acre_item, 0) * -1 ELSE 0 END)`;
    const sub = sql`(trunc((v.qtde * v.vrvenda)::numeric * 100)::numeric(13,2) / 100)`;
    const custo = sql`(v.qtde * v.vrcusto)::numeric(18,2)`;
    const linhas = (await sql<Record<string, unknown>>`
      SELECT avg(v.vrvenda)::numeric(18,2) AS vrvenda, avg(v.vrcusto)::numeric(18,2) AS vrcusto, sum(v.qtde) AS qtde,
             sum(${custo}) AS total_custo,
             sum(${sub}) + sum(${acre}) - sum(${desc}) AS total_venda,
             sum(${sub}) AS sub_total_venda,
             (sum(${sub}) + sum(${acre}) - sum(${desc}) - sum(${custo}))::numeric(13,2) AS lucro_total,
             v.codproduto, p.descricao, p.codbarra, sum(${desc}) AS desconto, sum(${acre}) AS acrescimo
        FROM vendas v
        LEFT JOIN produtos p ON p.idproduto = v.codproduto
       WHERE v.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         AND (v.cancelado = 'N' OR v.cancelado IS NULL)
         AND v.idempresa = ANY(${emps})
       GROUP BY v.codproduto, p.descricao, p.codbarra
       ORDER BY p.descricao`.execute(db)).rows
      .map((l) => ({
        codproduto: l.codproduto == null ? null : Number(l.codproduto), descricao: (l.descricao as string | null) ?? null, codbarra: (l.codbarra as string | null) ?? null,
        vrvenda: num(l.vrvenda), vrcusto: num(l.vrcusto), qtde: num(l.qtde), desconto: num(l.desconto), acrescimo: num(l.acrescimo),
        total_custo: num(l.total_custo), total_venda: num(l.total_venda), sub_total_venda: num(l.sub_total_venda), lucro_total: num(l.lucro_total),
      }));
    if (!linhas.length) throw new BusinessRuleError('SIMULADOR_SEM_VENDAS', {}, 'Não foram encontradas vendas no período informado.');
    return { empresas: emps, linhas, totais: SimuladorVendaService.totais(linhas) };
  }

  /**
   * O `SetaTotais` sobre os agregados do `cdsVendas` (Σ SUB_TOTAL_VENDA, TOTAL_VENDA, ACRESCIMO, DESCONTO, TOTAL_CUSTO): lucro = venda −
   * custo; lucro % = (venda / custo − 1) × 100 com venda e custo diferentes de zero — markup sobre o custo, não margem.
   */
  static totais(linhas: Array<{ sub_total_venda: number; total_venda: number; acrescimo: number; desconto: number; total_custo: number }>) {
    const s = (k: 'sub_total_venda' | 'total_venda' | 'acrescimo' | 'desconto' | 'total_custo') => linhas.reduce((a, l) => a + num(l[k]), 0);
    const venda = s('total_venda'), custo = s('total_custo');
    return {
      subtotal: s('sub_total_venda'), venda, acrescimo: s('acrescimo'), desconto: s('desconto'), custo, lucro: venda - custo,
      lucroPerc: venda !== 0 && custo !== 0 ? ((venda / custo) - 1) * 100 : 0,
    };
  }

  /**
   * O Imprimir (`btnImprimirClick` → `imprimir(frxReportDados)`): o relatório desenhado no próprio `uSimuladorVenda.dfm`, com o
   * `cdsVendas` no `frxDBDatasetDados` como a grade está — os valores simulados e a ordem da coluna clicada. Sem linhas, a mensagem.
   */
  impressao(dto: SimuladorVendaImpressaoDto) {
    return {
      titulo: 'Simulador de vendas',
      modelo: modeloEmbutido('frmSimuladorVenda.frxReportDados'),
      datasets: {
        frxDBDatasetDados: dto.linhas.map((l) => ({
          VRVENDA: num(l.vrvenda), VRCUSTO: num(l.vrcusto), ACRESCIMO: num(l.acrescimo), DESCONTO: num(l.desconto), QTDE: num(l.qtde),
          CODPRODUTO: l.codproduto ?? null, DESCRICAO: l.descricao ?? '', CODBARRA: l.codbarra ?? '', TOTAL_CUSTO: num(l.total_custo),
          TOTAL_VENDA: num(l.total_venda), LUCRO_TOTAL: num(l.lucro_total), SUB_TOTAL_VENDA: num(l.sub_total_venda),
        })),
      },
    };
  }
}
