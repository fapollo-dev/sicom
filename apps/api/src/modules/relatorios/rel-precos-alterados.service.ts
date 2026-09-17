import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelPrecosAlteradosDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** o histórico guarda o valor como TEXTO, e em pt-BR ('17,90'). */
const numBr = (v: unknown) => (v == null || v === '' ? null : Number(String(v).replace(/\./g, '').replace(',', '.')));

/**
 * RELATÓRIO DE PREÇOS ALTERADOS (`FRMRELPRECOSALTERADOS`). **35 acessos, 4 operadores.**
 * Dossiê: `uRelPrecosAlterados.md`. Migration 244.
 *
 * Que preços mudaram no período, **de quanto para quanto** e por quem. Duas origens, como no legado: o preço
 * em vigor (`multi_preco`, por `DTULTPRECOALTERADO`) ou o lote de alteração (`lotepreco`, por `DATALOTE` —
 * 96.863 lotes no cliente, o último de hoje).
 *
 * ── ⚠️ O relatório escondia MAIS DA METADE das alterações ─────────────────────────────────────────────
 * O legado usa **`JOIN HISTORICO_DINAMICO H ON H.CODHISTORICO = M.CODHISTORICO`** — INNER. E
 * `MULTI_PRECO.CODHISTORICO` está preenchido em apenas **87.708 de 203.615** linhas (43%). Medido em
 * agosto/2026 na empresa 1: **594 preços alterados, e o relatório mostrava 266** — **328 alterações (55,2%)
 * simplesmente não apareciam**, por falta do vínculo com o histórico.
 *
 * Aqui o join é LEFT: sem histórico o preço **anterior** fica vazio, mas a alteração aparece. Um relatório de
 * preços alterados que esconde metade das alterações não cumpre o que promete.
 *
 * ── ⚠️ `ROWNUM = 1 ... ORDER BY` no outro dataset ─────────────────────────────────────────────────────
 * O `sqqConsulta` do data module busca o valor anterior com `AND ROWNUM = 1 ORDER BY CODHISTORICO DESC`. No
 * Oracle o `ROWNUM` é aplicado **antes** do `ORDER BY`, então a linha devolvida é arbitrária. Verificado no
 * produto 8242, que tem 9 registros: o legado devolve **17,90** onde o correto é **12,99**. E
 * **11.999 de 15.300** produtos com histórico de preço têm mais de um registro, ou seja, a maioria.
 */
@Injectable()
export class RelPrecosAlteradosService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: RelPrecosAlteradosDto): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { itens: number; subiram: number; caíram: number; semAnterior: number; variacaoMedia: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const produto = f.produto ? `%${f.produto.toUpperCase()}%` : null;
    const promo = f.promocao === 'PROMOCAO' ? sql`AND m.promocao = 'S'`
      : f.promocao === 'NORMAL' ? sql`AND coalesce(m.promocao, 'N') = 'N'` : sql``;

    const linhas = f.origem === 'LOTE'
      ? (await sql<Record<string, unknown>>`
          SELECT l.idproduto AS codproduto, p.codbarra, p.descricao,
                 fa.descricao AS dpto, l.datalote AS data, l.vrvenda AS valor,
                 coalesce(l.promocao, 'N') AS promocao, l.vrpromo,
                 o.nome AS usuario, l.codoperador,
                 -- o anterior do lote é o custo/preço guardado nele; sem histórico não se inventa
                 h.valor_anterior AS valor_ant, l.origem, l.processado
            FROM lote_preco l
            LEFT JOIN produtos p       ON p.idproduto = l.idproduto
            LEFT JOIN familias_prod fa ON fa.codfamilia = p.coddpto
            LEFT JOIN operadores o     ON o.codoperador = l.codoperador
            LEFT JOIN multi_preco m    ON m.idproduto = l.idproduto AND m.idempresa = l.codempresa
            LEFT JOIN historico_dinamico h ON h.codhistorico = m.codhistorico
           WHERE l.codempresa = ${emp}
             AND l.datalote::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
             AND (${f.coddpto ?? null}::int IS NULL OR p.coddpto = ${f.coddpto ?? null}::int)
             AND (${produto}::text IS NULL
                  OR upper(coalesce(p.descricao, '')) LIKE ${produto}::text
                  OR coalesce(p.codbarra, '') LIKE ${produto}::text)
             AND (${f.semGrupoPreco} = 'N' OR coalesce(p.codgrupopreco, 0) = 0)
           ORDER BY fa.descricao, p.descricao
           LIMIT ${f.limite}
        `.execute(db)).rows
      : (await sql<Record<string, unknown>>`
          SELECT m.idproduto AS codproduto, p.codbarra, p.descricao,
                 fa.descricao AS dpto, m.dtultprecoalterado AS data,
                 CASE WHEN m.promocao = 'S' THEN m.vrpromo ELSE m.vrvenda END AS valor,
                 coalesce(m.promocao, 'N') AS promocao, m.vrpromo,
                 o.nome AS usuario, h.codoperador,
                 h.valor_anterior AS valor_ant, NULL::text AS origem, NULL::text AS processado
            FROM multi_preco m
            LEFT JOIN produtos p       ON p.idproduto = m.idproduto
            LEFT JOIN familias_prod fa ON fa.codfamilia = p.coddpto
            -- ⚠️ no legado este JOIN é INNER, e "codhistorico" só existe em 43% das linhas: 328 de 594
            -- alterações de agosto/2026 sumiam do relatório
            LEFT JOIN historico_dinamico h ON h.codhistorico = m.codhistorico
            LEFT JOIN operadores o     ON o.codoperador = h.codoperador
           WHERE m.idempresa = ${emp}
             AND m.dtultprecoalterado::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
             ${promo}
             AND (${f.coddpto ?? null}::int IS NULL OR p.coddpto = ${f.coddpto ?? null}::int)
             AND (${produto}::text IS NULL
                  OR upper(coalesce(p.descricao, '')) LIKE ${produto}::text
                  OR coalesce(p.codbarra, '') LIKE ${produto}::text)
             AND (${f.semGrupoPreco} = 'N' OR coalesce(p.codgrupopreco, 0) = 0)
           ORDER BY fa.descricao, p.descricao
           LIMIT ${f.limite}
        `.execute(db)).rows;

    let subiram = 0; let cairam = 0; let semAnterior = 0; let somaVar = 0; let comVar = 0;
    const saida = linhas.map((l) => {
      const atual = num(l.valor);
      const ant = numBr(l.valor_ant);
      if (ant == null) semAnterior += 1;
      else if (atual > ant) subiram += 1;
      else if (atual < ant) cairam += 1;
      const variacao = ant != null && ant !== 0 ? r2((atual / ant - 1) * 100) : null;
      if (variacao != null) { somaVar += variacao; comVar += 1; }
      return { ...l, valor_anterior: ant, variacao_perc: variacao, diferenca: ant == null ? null : r2(atual - ant) };
    });

    return {
      linhas: saida,
      totais: {
        itens: saida.length, subiram, caíram: cairam, semAnterior,
        variacaoMedia: comVar ? r2(somaVar / comVar) : 0,
      },
    };
  }
}
