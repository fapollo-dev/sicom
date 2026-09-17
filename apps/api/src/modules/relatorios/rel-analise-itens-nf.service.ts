import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelAnaliseItensNfDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * ANÁLISE DE ITENS DA NOTA FISCAL (`FRMRELANALISEITENSNF`). **34 acessos, 4 operadores.**
 * Dossiê: `uRelAnaliseItensNF.md`. Migration 245.
 *
 * Item a item das notas do período, com custo, base de cálculo, ICMS, ST e o que é isento — é a conferência
 * que o fiscal faz antes de fechar a apuração.
 *
 * ── ⚠️ O `WHERE` do legado só filtra DATA ─────────────────────────────────────────────────────────────
 * `WHERE N.DTCONTABIL BETWEEN :D1 AND :D2` e nada mais: sem empresa, sem tipo de nota, sem cancelamento.
 * Medido em agosto/2026: **6.840 notas de entrada somadas com 943 de saída**, de **3 empresas**. Num
 * relatório de custo e crédito de ICMS, misturar saída com entrada e loja com loja não dá número de nada.
 * Aqui a empresa é a da sessão, o tipo é escolha (padrão **entrada**) e a cancelada fica fora por padrão.
 *
 * ── ⚠️ `NP.DESCONTO` sem `COALESCE` ───────────────────────────────────────────────────────────────────
 * `((NP.QUANTIDADE * NP.VRCUSTO) - NP.DESCONTO)` — com desconto nulo o total vira NULL e o item **some do
 * somatório**. São **23 linhas** de 497.627 em `NF_PROD`, mas some sem avisar; aqui o nulo é zero.
 *
 * ── Curiosidade do original, sem efeito ───────────────────────────────────────────────────────────────
 * `if Pos(FFiltro, 'N.CODNF') > 0` (`:138`) tem os argumentos **invertidos** — em Delphi é
 * `Pos(agulha, palheiro)`, e aqui o filtro inteiro foi passado como agulha. A condição quase nunca é
 * verdadeira, e não faz diferença: **os dois ramos do `if` fazem exatamente a mesma coisa**.
 */
@Injectable()
export class RelAnaliseItensNfService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: RelAnaliseItensNfDto): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { itens: number; quantidade: number; custo: number; base: number; icms: number; st: number; isento: number; outras: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;

    const linhas = (await sql<Record<string, unknown>>`
      SELECT n.codnf, n.nronf, n.tipo, n.dtcontabil, coalesce(p.razao, '(sem parceiro)') AS razao,
             pr.codbarra, pr.descricao, pr.coddpto, pr.codgrupo,
             np.quantidade, np.vrcusto,
             -- ⚠️ o desconto nulo virava NULL na conta inteira e o item sumia do total (23 de 497.627)
             round(((np.quantidade * np.vrcusto) - coalesce(np.desconto, 0))::numeric, 2) AS total_custo,
             coalesce(np.vrbasecalculo, 0) AS vrbasecalculo,
             coalesce(np.vricm, 0) AS vricm,
             coalesce(np.vroutrasdesp, 0) AS vroutrasdesp,
             CASE WHEN np.aliquota = 'IST'
                  THEN round(((np.quantidade * np.vrcusto) - coalesce(np.desconto, 0))::numeric, 2)
                  ELSE 0 END AS isento,
             coalesce(np.vrbasest, 0) AS vrbasest,
             coalesce(np.vricmst, 0) AS vricmst,
             np.aliquota
        FROM nf n
        LEFT JOIN nf_prod np   ON np.codnf = n.codnf
        LEFT JOIN parceiros p  ON p.codparceiro = n.codparceiro
        LEFT JOIN produtos pr  ON pr.idproduto = np.codproduto
       -- ⚠️ o legado não tem nenhuma destas três: empresa, tipo e cancelamento
       WHERE n.idempresa = ${emp}
         AND n.dtcontabil::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         AND (${f.tipo} = 'TODAS' OR n.tipo = ${f.tipo})
         AND (${f.incluirCanceladas} = 'S' OR coalesce(n.cancelada, 'N') <> 'S')
         AND (${f.codfor ?? null}::int     IS NULL OR n.codparceiro = ${f.codfor ?? null}::int)
         AND (${f.coddpto ?? null}::int    IS NULL OR pr.coddpto    = ${f.coddpto ?? null}::int)
         AND (${f.codgrupo ?? null}::int   IS NULL OR pr.codgrupo   = ${f.codgrupo ?? null}::int)
         AND (${f.codproduto ?? null}::int IS NULL OR np.codproduto = ${f.codproduto ?? null}::int)
         AND (${f.codnf ?? null}::int      IS NULL OR n.codnf       = ${f.codnf ?? null}::int)
       ORDER BY n.dtcontabil, n.nronf, pr.descricao
       LIMIT ${f.limite}
    `.execute(db)).rows;

    const t = { itens: linhas.length, quantidade: 0, custo: 0, base: 0, icms: 0, st: 0, isento: 0, outras: 0 };
    for (const l of linhas) {
      t.quantidade += num(l.quantidade); t.custo += num(l.total_custo);
      t.base += num(l.vrbasecalculo); t.icms += num(l.vricm);
      t.st += num(l.vricmst); t.isento += num(l.isento); t.outras += num(l.vroutrasdesp);
    }
    return {
      linhas,
      totais: {
        itens: t.itens, quantidade: r2(t.quantidade), custo: r2(t.custo), base: r2(t.base),
        icms: r2(t.icms), st: r2(t.st), isento: r2(t.isento), outras: r2(t.outras),
      },
    };
  }
}
