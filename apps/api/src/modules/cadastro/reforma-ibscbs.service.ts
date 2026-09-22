import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type {
  CclassTribNcmConsultaDto, ClassTribDto, CstIbsCbsDto, IbsUfDto, ReformaConsultaDto,
} from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * REFORMA TRIBUTÁRIA IBS/CBS — cadastros (`FRMCADCSTIBSCBS` e `FRMCADCLASSTRIBIBSCBS`).
 * Migration 278. Dossiê: `uCadIBSCBS.md`.
 *
 * O fonte clonado é de mai/2020 e a reforma é a EC 132/2023 + LC 214/2025: as units não existem lá. O
 * material é o dado da produção, onde o mecanismo já roda — 98.747 itens de nota com IBS/CBS calculado
 * (68.677 só em 2026) e 44.501 dos 47.729 produtos já classificados.
 *
 * ⚠️ A regra que uma implementação ingênua quebra: a redução de IBS e a de CBS são **independentes**
 * (há classificação com 60 no IBS e 100 na CBS). Nada aqui colapsa as duas num percentual só.
 */
@Injectable()
export class ReformaIbsCbsService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private op() { return currentTenant().operadorId ?? null; }

  // ─── CST (tela 145) ─────────────────────────────────────────────────────────────────────────────────

  /**
   * O catálogo de CST. `so_nfe` filtra pelas que valem para NF-e — são 9 flags por documento fiscal, e a
   * mesma CST vale para um e não para outro (das 17 do cliente, só 6 valem para NF-e).
   */
  async listarCst(q: ReformaConsultaDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const termo = (q.q ?? '').trim().toUpperCase();
    const rows = (await sql<Record<string, unknown>>`
        SELECT c.*, (SELECT count(*) FROM class_trib t
                      WHERE t.cst = c.cst AND coalesce(t.indr, 'I') <> 'E') AS classificacoes
          FROM cst_ibs_cbs c
         WHERE (${termo}::text = '' OR c.cst LIKE ${termo + '%'}
                OR upper(c.descricao_cst) LIKE ${'%' + termo + '%'})
           AND (NOT ${q.so_nfe}::boolean OR c.ind_nfe = 'S')
           AND (${q.incluir_estornadas}::boolean OR coalesce(c.indr, 'I') <> 'E')
         ORDER BY c.cst
         LIMIT ${q.limite}`.execute(db)).rows;
    return rows.map((r) => ({ ...r, classificacoes: Number(r.classificacoes ?? 0) }));
  }

  async gravarCst(d: CstIbsCbsDto) {
    const db = this.dbp.forTenant() as AnyDB;
    await sql`
      INSERT INTO cst_ibs_cbs (cst, descricao_cst, ind_gibscbs, ind_gibscbsmono, ind_gred, ind_gdif,
                               ind_gtranf_cred, ind_nfe, ind_nfce, ind_cte, ind_cteos, ind_bpe, ind_bpetm,
                               ind_nf3e, ind_nfcom, ind_nfse, usultalteracao, dtultimalteracao)
      VALUES (${d.cst}, ${d.descricao_cst}, ${d.ind_gibscbs}, ${d.ind_gibscbsmono}, ${d.ind_gred},
              ${d.ind_gdif}, ${d.ind_gtranf_cred}, ${d.ind_nfe}, ${d.ind_nfce}, ${d.ind_cte},
              ${d.ind_cteos}, ${d.ind_bpe}, ${d.ind_bpetm}, ${d.ind_nf3e}, ${d.ind_nfcom}, ${d.ind_nfse},
              ${this.op()}, now())
      ON CONFLICT (cst) DO UPDATE SET
        descricao_cst = excluded.descricao_cst, ind_gibscbs = excluded.ind_gibscbs,
        ind_gibscbsmono = excluded.ind_gibscbsmono, ind_gred = excluded.ind_gred,
        ind_gdif = excluded.ind_gdif, ind_gtranf_cred = excluded.ind_gtranf_cred,
        ind_nfe = excluded.ind_nfe, ind_nfce = excluded.ind_nfce, ind_cte = excluded.ind_cte,
        ind_cteos = excluded.ind_cteos, ind_bpe = excluded.ind_bpe, ind_bpetm = excluded.ind_bpetm,
        ind_nf3e = excluded.ind_nf3e, ind_nfcom = excluded.ind_nfcom, ind_nfse = excluded.ind_nfse,
        indr = NULL, indr_usuario = NULL, indr_data = NULL,
        usultalteracao = ${this.op()}, dtultimalteracao = now()`.execute(db);
    return { cst: d.cst };
  }

  // ─── classificação tributária (tela 110) ────────────────────────────────────────────────────────────

  /** As 132 classificações da LC 214/2025, com a redação do artigo e as duas reduções separadas. */
  async listarClassTrib(q: ReformaConsultaDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const termo = (q.q ?? '').trim().toUpperCase();
    const rows = (await sql<Record<string, unknown>>`
        SELECT t.*, (SELECT count(*) FROM produtos p WHERE p.codclass_trib = t.codclass_trib) AS produtos,
               (SELECT count(*) FROM cclass_trib_ncm n WHERE n.cclass_trib = t.class_trib) AS ncms
          FROM class_trib t
         WHERE (${termo}::text = '' OR t.class_trib LIKE ${termo + '%'}
                OR upper(t.nome_class_trib) LIKE ${'%' + termo + '%'}
                OR upper(coalesce(t.lc_214_25, '')) LIKE ${'%' + termo + '%'})
           AND (${q.cst ?? ''}::text = '' OR t.cst = ${q.cst ?? ''})
           AND (${q.incluir_estornadas}::boolean OR coalesce(t.indr, 'I') <> 'E')
         ORDER BY t.class_trib
         LIMIT ${q.limite}`.execute(db)).rows;
    return rows.map((r) => ({
      ...r,
      pred_ibs: r.pred_ibs == null ? null : Number(r.pred_ibs),
      pred_cbs: r.pred_cbs == null ? null : Number(r.pred_cbs),
      produtos: Number(r.produtos ?? 0),
      ncms: Number(r.ncms ?? 0),
    }));
  }

  async gravarClassTrib(d: ClassTribDto) {
    const db = this.dbp.forTenant() as AnyDB;
    // a CST tem de existir no catálogo: é ela que decide os grupos do XML
    const cst = (await sql<{ cst: string }>`
        SELECT cst FROM cst_ibs_cbs WHERE cst = ${d.cst}`.execute(db)).rows[0];
    if (!cst) throw new BusinessRuleError('CST_IBSCBS_NAO_CADASTRADA', { cst: d.cst });
    const r = (await sql<{ codclass_trib: number }>`
      INSERT INTO class_trib (cst, descricao_cst, class_trib, nome_class_trib, descricao_class_trib,
                              lc_redacao, lc_214_25, tipo_aliquota, pred_ibs, pred_cbs, ind_redutor_bc,
                              ind_gtrib_regular, ind_cred_pres, ind_mono, ind_mono_reten, ind_mono_ret,
                              ind_mono_dif, credito_para, d_ini_vig, d_fim_vig, data_atualizacao,
                              usultalteracao, dtultimalteracao)
      VALUES (${d.cst}, ${d.descricao_cst}, ${d.class_trib}, ${d.nome_class_trib},
              ${d.descricao_class_trib ?? null}, ${d.lc_redacao ?? null}, ${d.lc_214_25 ?? null},
              ${d.tipo_aliquota ?? null}, ${d.pred_ibs ?? null}, ${d.pred_cbs ?? null},
              ${d.ind_redutor_bc ?? null}, ${d.ind_gtrib_regular ?? null}, ${d.ind_cred_pres ?? null},
              ${d.ind_mono ?? null}, ${d.ind_mono_reten ?? null}, ${d.ind_mono_ret ?? null},
              ${d.ind_mono_dif ?? null}, ${d.credito_para ?? null},
              ${d.d_ini_vig ?? null}::date, ${d.d_fim_vig ?? null}::date, now(), ${this.op()}, now())
      ON CONFLICT (class_trib) WHERE coalesce(indr, 'I') <> 'E' DO UPDATE SET
        cst = excluded.cst, descricao_cst = excluded.descricao_cst,
        nome_class_trib = excluded.nome_class_trib,
        descricao_class_trib = excluded.descricao_class_trib, lc_redacao = excluded.lc_redacao,
        lc_214_25 = excluded.lc_214_25, tipo_aliquota = excluded.tipo_aliquota,
        pred_ibs = excluded.pred_ibs, pred_cbs = excluded.pred_cbs,
        ind_redutor_bc = excluded.ind_redutor_bc, ind_gtrib_regular = excluded.ind_gtrib_regular,
        ind_cred_pres = excluded.ind_cred_pres, ind_mono = excluded.ind_mono,
        ind_mono_reten = excluded.ind_mono_reten, ind_mono_ret = excluded.ind_mono_ret,
        ind_mono_dif = excluded.ind_mono_dif, credito_para = excluded.credito_para,
        d_ini_vig = excluded.d_ini_vig, d_fim_vig = excluded.d_fim_vig, data_atualizacao = now(),
        usultalteracao = ${this.op()}, dtultimalteracao = now()
      RETURNING codclass_trib`.execute(db)).rows[0];
    return { codclass_trib: Number(r.codclass_trib) };
  }

  /**
   * Estorno lógico. Recusa quando produtos ainda apontam a classificação: no cliente há classificação com
   * milhares de produtos, e apagá-la deixaria a nota sem cClassTrib — rejeição na SEFAZ, não erro interno.
   */
  async excluirClassTrib(codclass_trib: number) {
    // ⚠️ validar FORA da transação do UPDATE é TOCTOU: entre o SELECT que conta os produtos e o UPDATE que
    // estorna, outra sessão pode classificar um produto — e ele ficaria apontando classificação estornada.
    // A linha é travada antes da contagem.
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const alvo = (await sql<{ codclass_trib: number; class_trib: string; indr: string | null }>`
          SELECT codclass_trib, class_trib, indr FROM class_trib
           WHERE codclass_trib = ${codclass_trib} FOR UPDATE`.execute(trx)).rows[0];
      if (!alvo || (alvo.indr ?? 'I') === 'E')
        throw new BusinessRuleError('CLASS_TRIB_NAO_ENCONTRADA', { codclass_trib });

      const uso = (await sql<{ produtos: string; notas: string; ncms: string }>`
          SELECT (SELECT count(*) FROM produtos WHERE codclass_trib = ${codclass_trib}) AS produtos,
                 (SELECT count(*) FROM nf_prod_ibscbs WHERE cclasstrib = ${alvo.class_trib}) AS notas,
                 (SELECT count(*) FROM cclass_trib_ncm WHERE cclass_trib = ${alvo.class_trib}) AS ncms`
        .execute(trx)).rows[0];
      // produto apontando é o que BARRA: a próxima nota desse produto sairia sem cClassTrib e a SEFAZ
      // rejeita. Itens de nota já calculados e vínculos de NCM não barram — são histórico, e a consulta
      // dos grupos mostra o nome mesmo depois do estorno —, mas vão no detalhe para quem decide ver.
      if (Number(uso.produtos) > 0)
        throw new BusinessRuleError('CLASS_TRIB_EM_USO', {
          codclass_trib, produtos: Number(uso.produtos),
          itens_de_nota: Number(uso.notas), vinculos_ncm: Number(uso.ncms),
        });

      await sql`UPDATE class_trib SET indr = 'E', indr_usuario = ${this.op()}, indr_data = now()
                 WHERE codclass_trib = ${codclass_trib}`.execute(trx);
      return {
        codclass_trib, itens_de_nota: Number(uso.notas), vinculos_ncm: Number(uso.ncms),
      };
    });
  }

  // ─── de-para cClassTrib × NCM ───────────────────────────────────────────────────────────────────────

  /**
   * O anexo da LC 214/2025 que enquadra o NCM. Busca por PREFIXO: o anexo lista NCM de 8 dígitos, e quem
   * consulta costuma ter o capítulo (2) ou a posição (4) na mão.
   */
  async ncmDaClassificacao(q: CclassTribNcmConsultaDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await sql<Record<string, unknown>>`
        SELECT n.*, t.nome_class_trib, t.pred_ibs, t.pred_cbs
          FROM cclass_trib_ncm n
          LEFT JOIN class_trib t ON t.class_trib = n.cclass_trib AND coalesce(t.indr, 'I') <> 'E'
         WHERE (${q.ncm ?? ''}::text = '' OR n.codigo_ncm LIKE ${(q.ncm ?? '') + '%'})
           AND (${q.cclass_trib ?? ''}::text = '' OR n.cclass_trib = ${q.cclass_trib ?? ''})
           AND (${q.anexo ?? ''}::text = '' OR n.anexo = ${q.anexo ?? ''})
         ORDER BY n.codigo_ncm, n.cclass_trib
         LIMIT ${q.limite}`.execute(db)).rows;
    return rows.map((r) => ({
      ...r,
      pred_ibs: r.pred_ibs == null ? null : Number(r.pred_ibs),
      pred_cbs: r.pred_cbs == null ? null : Number(r.pred_cbs),
    }));
  }

  // ─── alíquota de IBS por UF ─────────────────────────────────────────────────────────────────────────

  /**
   * As 27 UFs, e ao lado o que `tributacao_reforma` (mig 007) diz para a mesma UF na data de hoje. As duas
   * fontes existem de propósito: esta é a tabela operacional do cliente, aquela é o parâmetro com vigência
   * e CBS. Quando divergem, quem manda no cálculo é `tributacao_reforma` — aqui a divergência fica VISÍVEL
   * em vez de silenciosa.
   */
  async listarIbsUf() {
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await sql<Record<string, unknown>>`
        SELECT u.codibs_uf, u.uf, u.valor_ibs_uf,
               p.ibs AS ibs_parametro, p.cbs AS cbs_parametro, p.vigencia_inicio, p.fonte
          FROM ibs_uf u
          LEFT JOIN LATERAL (
                 SELECT r.ibs, r.cbs, r.vigencia_inicio, r.fonte
                   FROM tributacao_reforma r
                  WHERE r.uf = u.uf AND r.vigencia_inicio <= current_date
                  ORDER BY r.vigencia_inicio DESC LIMIT 1) p ON true
         ORDER BY u.uf`.execute(db)).rows;
    return rows.map((r) => {
      const valor = Number(r.valor_ibs_uf);
      const param = r.ibs_parametro == null ? null : Number(r.ibs_parametro);
      return {
        ...r,
        valor_ibs_uf: valor,
        ibs_parametro: param,
        cbs_parametro: r.cbs_parametro == null ? null : Number(r.cbs_parametro),
        diverge: param != null && Math.abs(param - valor) > 0.0001,
      };
    });
  }

  async gravarIbsUf(d: IbsUfDto) {
    const db = this.dbp.forTenant() as AnyDB;
    await sql`
      INSERT INTO ibs_uf (uf, valor_ibs_uf) VALUES (${d.uf}, ${d.valor_ibs_uf})
      ON CONFLICT (uf) DO UPDATE SET valor_ibs_uf = excluded.valor_ibs_uf`.execute(db);
    return { uf: d.uf };
  }
}
