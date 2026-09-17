import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { lucroPercentual, type SimuladorVendaDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * SIMULADOR DE VENDAS (`FRMSIMULADORVENDA`, `uSimuladorVenda.pas`). **42 acessos, 5 operadores.**
 * Dossiê: `uSimuladorVenda.md`. Migration 239.
 *
 * Pega o que foi vendido num período, produto a produto, com custo, venda, descontos e acréscimos — e é sobre
 * essa base que o operador simula: "se eu tivesse vendido a tanto, quanto teria sobrado?".
 *
 * ── ⚠️ O legado soma TODAS as empresas ────────────────────────────────────────────────────────────────
 * A query (`sqqTotais`) filtra só a data e o cancelado: **não há `IDEMPRESA` em lugar nenhum**. Medido em
 * agosto/2026: a tela mostra **R$ 2.227.179,71** quando a empresa 1 vendeu **R$ 1.153.860,03** e a 2 vendeu
 * **R$ 1.073.319,68** — quase o dobro. Quem simula o preço da sua loja está olhando o volume das duas, e como
 * o lucro sai de médias, o número perde o significado. Aqui é tenant-scoped.
 *
 * ── As contas, copiadas linha a linha ─────────────────────────────────────────────────────────────────
 * ⚠️ **a venda TRUNCA e o custo ARREDONDA**, e isso é do legado: `trunc(qtde × vrvenda × 100)/100` contra
 *    `CAST(qtde × vrcusto AS NUMERIC(18,2))`. A assimetria muda centavos por linha e foi mantida.
 * · acréscimo = a parte POSITIVA de `DESC_ACRE_MEDIO` e `DESC_ACRE_ITEM`
 * · desconto  = `DESC_PROMOCAO` + `DESC_DEPARTAMENTO` + a parte NEGATIVA daqueles dois, em módulo
 * · venda total = subtotal + acréscimo − desconto · lucro = venda total − custo total
 * ⚠️ **o "Lucro %" é markup sobre o CUSTO**, não margem sobre a venda (`:156`): venda 150 sobre custo 100
 *    mostra 50%, não 33,3%. Mantido — trocar mudaria todo número que o operador conhece.
 */
@Injectable()
export class SimuladorVendaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: SimuladorVendaDto): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { custo: number; subtotal: number; desconto: number; acrescimo: number; venda: number; lucro: number; lucroPerc: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const produto = f.produto ? `%${f.produto.toUpperCase()}%` : null;

    const linhas = (await sql<Record<string, unknown>>`
      SELECT v.codproduto, p.descricao, p.codbarra, p.unidade,
             sum(v.qtde) AS qtde,
             round(avg(v.vrvenda)::numeric, 2) AS vrvenda,
             round(avg(v.vrcusto)::numeric, 2) AS vrcusto,
             -- o custo ARREDONDA
             sum(round((v.qtde * v.vrcusto)::numeric, 2)) AS total_custo,
             -- a venda TRUNCA: trunc(x*100)/100, como o legado
             sum(trunc((v.qtde * v.vrvenda)::numeric * 100) / 100) AS sub_total_venda,
             sum(greatest(coalesce(v.desc_acre_medio, 0), 0)
               + greatest(coalesce(v.desc_acre_item, 0), 0)) AS acrescimo,
             sum(coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
               + abs(least(coalesce(v.desc_acre_medio, 0), 0))
               + abs(least(coalesce(v.desc_acre_item, 0), 0))) AS desconto
        FROM vendas v
        LEFT JOIN produtos p ON p.idproduto = v.codproduto
       -- ⚠️ o legado NÃO filtra empresa: em agosto/2026 isso somava as duas lojas (R$ 2,23 mi contra R$ 1,15 mi)
       WHERE v.idempresa = ${emp}
         AND v.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         AND coalesce(v.cancelado, 'N') = 'N'
         AND (${produto}::text IS NULL
              OR upper(coalesce(p.descricao, '')) LIKE ${produto}::text
              OR coalesce(p.codbarra, '') LIKE ${produto}::text)
       GROUP BY v.codproduto, p.descricao, p.codbarra, p.unidade
       ORDER BY p.descricao
       LIMIT ${f.limite}
    `.execute(db)).rows;

    const t = { custo: 0, subtotal: 0, desconto: 0, acrescimo: 0, venda: 0, lucro: 0, lucroPerc: 0 };
    const saida = linhas.map((l) => {
      const custo = num(l.total_custo);
      const sub = num(l.sub_total_venda);
      const acre = num(l.acrescimo);
      const desc = num(l.desconto);
      const venda = r2(sub + acre - desc);
      const lucro = r2(venda - custo);
      t.custo += custo; t.subtotal += sub; t.acrescimo += acre; t.desconto += desc;
      t.venda += venda; t.lucro += lucro;
      return { ...l, total_venda: venda, lucro_total: lucro, lucro_perc: lucroPercentual(venda, custo) };
    });

    t.custo = r2(t.custo); t.subtotal = r2(t.subtotal); t.acrescimo = r2(t.acrescimo);
    t.desconto = r2(t.desconto); t.venda = r2(t.venda); t.lucro = r2(t.lucro);
    t.lucroPerc = lucroPercentual(t.venda, t.custo);
    return { linhas: saida, totais: t };
  }
}
