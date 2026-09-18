import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { PrecificacaoNfBrutaAplicarDto, PrecificacaoNfBrutaConsultaDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/**
 * PRECIFICAÇÃO PELA NF "BRUTA" (`FRMPRECIFICACAONFBRUTA`). **11 acessos, 4 operadores** (último
 * 17/06/2026). Dossiê: `uPrecificacaoNFBruta.md`. Migration 273.
 *
 * A irmã enxuta da precificação por NF (mig 211-212): os itens da nota de ENTRADA com preço atual, custo
 * de reposição, PMZ, preço sugerido e markup fixo — e o Aplicar enfileira o lote de preço com o preço
 * sugerido e grava `multi_preco.markupfixo`.
 *
 * ── Os dois defeitos do legado, corrigidos e documentados ─────────────────────────────────────────────
 * 1. o legado abre e fecha transação **por item** (uPrecificacaoNFBruta.pas:761-780) — falhando no quinto,
 *    os quatro primeiros ficam gravados e o lote sai pela metade. Aqui é uma transação para o lote todo;
 * 2. o `INSERT` do lote usa a empresa **da nota** e o `UPDATE` do markup fixo usa a empresa **logada** —
 *    precificando nota de outra loja, o preço vai para uma e o markup para outra. Aqui as duas seguem o
 *    tenant, e item de nota de outra empresa é recusado.
 *
 * E o lote passa a nascer com `origem = 'PRECIFICACAO_NF_BRUTA'`: no cliente, as 67.855 linhas de
 * `LOTEPRECO` com origem nula são justamente as desta tela, que não preenche a coluna.
 */
@Injectable()
export class PrecificacaoNfBrutaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(q: PrecificacaoNfBrutaConsultaDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const nronf = q.nronf?.trim() || null;
    const cod = q.codparceiro ?? null;
    const ini = q.dataIni ?? null;
    const fim = q.dataFim ?? null;

    const rows = (await sql<Record<string, unknown>>`
      SELECT n.idempresa, p.codnfprod, p.codnf, p.codproduto, p.codprodnota, pr.codbarra, pr.descricao,
             (p.quantidade * coalesce(p.fatorembal, 1)) AS quantidade,
             p.ultcusto, p.pmz, coalesce(p.vrvendasug, 0) AS vrvendasug,
             m.vrvenda, m.vrcustorep AS vrcusto, coalesce(m.markupfixo, 0) AS markupfixo,
             pr.idproduto, n.nronf, n.dtemissao, par.razao AS fornecedor
        FROM nf_prod p
        JOIN nf n            ON n.codnf = p.codnf
        LEFT JOIN produtos pr    ON pr.idproduto = p.codproduto
        LEFT JOIN parceiros par  ON par.codparceiro = n.codparceiro
        LEFT JOIN multi_preco m  ON m.idproduto = p.codproduto AND m.idempresa = n.idempresa
       WHERE n.tipo = 'E' AND n.idempresa = ${emp}
         AND (${nronf}::text IS NULL OR n.nronf = ${nronf}::text)
         AND (${cod}::integer IS NULL OR n.codparceiro = ${cod}::integer)
         AND (${ini}::date IS NULL OR n.dtemissao >= ${ini}::date)
         AND (${fim}::date IS NULL OR n.dtemissao <= ${fim}::date)
       ORDER BY pr.descricao
       LIMIT ${q.limite}`.execute(db)).rows;

    const itens = rows.map((r) => {
      const vrvenda = num(r.vrvenda);
      const sugerido = num(r.vrvendasug);
      return {
        codnfprod: Number(r.codnfprod), codnf: Number(r.codnf), nronf: r.nronf, dtemissao: r.dtemissao,
        fornecedor: r.fornecedor ?? null, idproduto: Number(r.idproduto ?? r.codproduto),
        codbarra: r.codbarra ?? null, codprodnota: r.codprodnota ?? null, descricao: r.descricao ?? '',
        quantidade: num(r.quantidade), ultcusto: num(r.ultcusto), pmz: num(r.pmz),
        vrcusto: num(r.vrcusto), vrvenda, vrvendasug: sugerido, markupfixo: num(r.markupfixo),
        /** o critério do legado para marcar a linha: sugerido diferente do atual */
        temSugestao: sugerido > 0 && r2(sugerido) !== r2(vrvenda),
        diferenca: sugerido > 0 ? r2(sugerido - vrvenda) : 0,
      };
    });
    const lista = q.somenteComSugestao ? itens.filter((i) => i.temSugestao) : itens;
    return {
      itens: lista,
      truncado: rows.length >= q.limite,
      totais: {
        itens: lista.length,
        comSugestao: itens.filter((i) => i.temSugestao).length,
        semPreco: itens.filter((i) => i.vrvenda <= 0).length,
        semMarkupFixo: itens.filter((i) => i.markupfixo <= 0).length,
      },
    };
  }

  async aplicar(dto: PrecificacaoNfBrutaAplicarDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const lotes: Array<Record<string, unknown>> = [];
      let markups = 0;
      for (const it of dto.itens) {
        const prod = (await sql<Record<string, unknown>>`
          SELECT idproduto FROM produtos WHERE idproduto = ${it.idproduto}`.execute(trx)).rows[0];
        if (!prod) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: it.idproduto });

        const l = (await sql<{ codlotepreco: unknown }>`
          INSERT INTO lote_preco (idproduto, codempresa, vrvenda, markup, datalote, processado, obs, codoperador, origem, dtcadastro)
          VALUES (${it.idproduto}, ${emp}, ${r2(it.vrvenda)}, ${it.markup == null ? null : r4(it.markup)}, current_date, 'N',
                  ${dto.obs ?? `REFERENTE A PRECIFICAÇÃO NOTA FISCAL DE NRO. ${it.nronf ?? ''}`.trim()},
                  ${op}, 'PRECIFICACAO_NF_BRUTA', now())
          RETURNING codlotepreco`.execute(trx)).rows[0];
        lotes.push({ codlotepreco: Number(l.codlotepreco), idproduto: it.idproduto, vrvenda: r2(it.vrvenda) });

        if (it.markupfixo != null) {
          const u = await sql`
            UPDATE multi_preco SET markupfixo = ${r4(it.markupfixo)}
             WHERE idproduto = ${it.idproduto} AND idempresa = ${emp}`.execute(trx);
          markups += Number(u.numAffectedRows ?? 0);
        }
      }
      return { lotes, totais: { lotes: lotes.length, markupsAtualizados: markups, empresa: emp } };
    });
  }
}
