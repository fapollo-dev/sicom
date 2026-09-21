import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { NfIbsCbsCalculoDto, NfIbsCbsConsultaDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

const num = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const r4 = (v: number) => Math.round((v + Number.EPSILON) * 10000) / 10000;

/**
 * REFORMA TRIBUTÁRIA IBS/CBS — corte-2: os grupos na NOTA. Migration 279. Dossiê `uCadIBSCBS.md` §9.
 *
 * ⚠️ A regra central, medida em 97.005 itens de produção: o valor sai da alíquota **efetiva**, e a efetiva
 * se DERIVA da redução (`cheia × (1 − predaliq/100)`) em vez de ser lida da coluna que o legado grava.
 * Derivando acerta 96.966 no IBS (99,96%) e 89.277 na CBS; lendo `PALIQEFET_CBS`, só 56.129 — a coluna fica
 * em 0 em 46.677 itens cuja redução é 0. E quem usar a alíquota CHEIA cobra **R$ 103.951,14 a mais** nos
 * 31.633 itens com redução (23× no IBS e na CBS).
 */
@Injectable()
export class NfIbsCbsService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp() { return currentTenant().empresaId; }

  /**
   * A alíquota efetiva. É UMA função para os três tributos de propósito: o erro que ela evita é aplicar a
   * redução a um e esquecer do outro, e a redução de IBS e a de CBS são independentes (mig 278).
   */
  private efetiva(cheia: number, reducaoPct: number) {
    return r4(cheia * (1 - reducaoPct / 100));
  }

  /**
   * Recalcula os grupos da nota a partir da classificação de cada produto, e grava item e cabeçalho.
   *
   * O que vier do XML do fornecedor é preservado nas colunas `_ORI` — sem esse par não há conferência, e
   * no cliente **36.278 itens têm base diferente da que o fornecedor mandou** (R$ 4,9 milhões).
   */
  async calcular(d: NfIbsCbsCalculoDto) {
    const db = this.dbp.forTenant() as AnyDB;
    const empresaId = this.emp();

    const nf = (await sql<{ codnf: number; uf: string | null }>`
        SELECT f.codnf, coalesce(e.uf, pe.uf) AS uf
          FROM nf f
          LEFT JOIN empresas e ON e.idempresa = f.idempresa
          -- a UF que decide o IBS e a do ESTABELECIMENTO (e ele que recolhe); o endereco do parceiro
          -- entra so como reserva, e a tabela de parceiros nao guarda UF: ela mora no endereco.
          LEFT JOIN parceiros_end pe ON pe.codparceiro = f.codparceiro AND coalesce(pe.endereco_padrao, 'S') = 'S'
         WHERE f.codnf = ${d.codnf} AND f.idempresa = ${empresaId}
         LIMIT 1`.execute(db)).rows[0];
    if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf: d.codnf });

    // a alíquota vigente: o parâmetro com vigência (mig 007) manda, e `ibs_uf` entra só como reserva
    const aliq = (await sql<{ ibs: number | null; cbs: number | null; ibs_tab: number | null }>`
        SELECT (SELECT r.ibs FROM tributacao_reforma r
                 WHERE r.uf = ${nf.uf ?? ''} AND r.vigencia_inicio <= current_date
                 ORDER BY r.vigencia_inicio DESC LIMIT 1) AS ibs,
               (SELECT r.cbs FROM tributacao_reforma r
                 WHERE r.uf = ${nf.uf ?? ''} AND r.vigencia_inicio <= current_date
                 ORDER BY r.vigencia_inicio DESC LIMIT 1) AS cbs,
               (SELECT u.valor_ibs_uf FROM ibs_uf u WHERE u.uf = ${nf.uf ?? ''}) AS ibs_tab`
      .execute(db)).rows[0];
    const pIbsUf = num(aliq?.ibs ?? aliq?.ibs_tab);
    const pCbs = num(aliq?.cbs);
    if (pIbsUf === 0 && pCbs === 0)
      throw new BusinessRuleError('ALIQUOTA_REFORMA_AUSENTE', { uf: nf.uf, codnf: d.codnf });

    // cada item com a classificação do seu produto (a redução mora nela, e são DUAS)
    const itens = (await sql<Record<string, unknown>>`
        SELECT i.codnfprod, i.codproduto, i.total_produto_nota, i.quantidade, i.vrcusto, i.desconto,
               t.class_trib, t.cst, t.pred_ibs, t.pred_cbs,
               (SELECT n.codcclass_trib_ncm FROM cclass_trib_ncm n
                 WHERE n.cclass_trib = t.class_trib AND n.codigo_ncm = i.ncm LIMIT 1) AS codcclass_trib_ncm,
               g.cst AS cst_atual, g.cclasstrib AS cclass_atual, g.vbc AS vbc_atual,
               g.cst_ori, g.cclasstrib_ori, g.vbc_ori
          FROM nf_prod i
          LEFT JOIN produtos p ON p.idproduto = i.codproduto
          LEFT JOIN class_trib t ON t.codclass_trib = p.codclass_trib AND coalesce(t.indr, 'I') <> 'E'
          LEFT JOIN nf_prod_ibscbs g ON g.codnfprod = i.codnfprod
         WHERE i.codnf = ${d.codnf}
         ORDER BY i.nroitem`.execute(db)).rows;
    if (!itens.length) throw new BusinessRuleError('NF_SEM_ITENS', { codnf: d.codnf });

    const semClasse = itens.filter((i) => i.class_trib == null).length;
    if (semClasse > 0 && !d.permitir_sem_classificacao)
      throw new BusinessRuleError('PRODUTO_SEM_CLASSIFICACAO', { codnf: d.codnf, itens: semClasse });

    const tot = { vbc: 0, ibsuf: 0, ibsmun: 0, cbs: 0 };
    const linhas: Array<Record<string, unknown>> = [];

    for (const i of itens) {
      // a base: o total do produto na nota, menos desconto — a mesma base das outras contribuições
      const vbc = r2(num(i.total_produto_nota) || num(i.quantidade) * num(i.vrcusto) - num(i.desconto));
      // ⚠️ DECISÃO EXPLÍCITA, não efeito de `null` virando 0: item cujo produto não tem classificação é
      // tributado INTEGRAL (redução 0). É o conservador — paga o imposto cheio em vez de zerar o que não
      // se sabe — e é o que o legado faz, onde a CST padrão é 000 (tributação integral). Zerar seria
      // sonegar em silêncio. O caminho normal recusa a nota antes de chegar aqui
      // (422 PRODUTO_SEM_CLASSIFICACAO); isto só roda com `permitir_sem_classificacao`, e a resposta
      // devolve quantos itens saíram assim para que o cheio fique declarado.
      const semClassificacao = i.class_trib == null;
      const redIbs = semClassificacao ? 0 : num(i.pred_ibs);
      const redCbs = semClassificacao ? 0 : num(i.pred_cbs);
      const efIbsUf = this.efetiva(pIbsUf, redIbs);
      const efCbs = this.efetiva(pCbs, redCbs);
      const vibsuf = r2((vbc * efIbsUf) / 100);
      const vcbs = r2((vbc * efCbs) / 100);
      // IBS municipal: a fase-teste de 2026 não cobra (zerado nas 10.012 notas do cliente)
      const pIbsMun = 0, efIbsMun = 0, vibsmun = 0;

      // o que veio do fornecedor só é carimbado na PRIMEIRA vez: recalcular não pode reescrever a origem
      const cstOri = i.cst_ori ?? i.cst_atual ?? null;
      const cclassOri = i.cclasstrib_ori ?? i.cclass_atual ?? null;
      const vbcOri = i.vbc_ori ?? i.vbc_atual ?? null;

      await sql`
        INSERT INTO nf_prod_ibscbs (codnfprod, codnf, idempresa, codproduto, cst, cclasstrib, vbc,
                                    pibsuf, predaliq_ibsuf, paliqefet_ibsuf, vibsuf,
                                    pibsmun, predaliq_ibsmun, paliqefet_ibsmun, vibsmun,
                                    pcbs, predaliq_cbs, paliqefet_cbs, vcbs,
                                    codcclass_trib_ncm, cst_ori, cclasstrib_ori, vbc_ori)
        VALUES (${i.codnfprod}, ${d.codnf}, ${empresaId}, ${i.codproduto}, ${i.cst ?? null},
                ${i.class_trib ?? null}, ${vbc},
                ${pIbsUf}, ${redIbs}, ${efIbsUf}, ${vibsuf},
                ${pIbsMun}, ${0}, ${efIbsMun}, ${vibsmun},
                ${pCbs}, ${redCbs}, ${efCbs}, ${vcbs},
                ${i.codcclass_trib_ncm ?? null}, ${cstOri}, ${cclassOri}, ${vbcOri})
        ON CONFLICT (codnfprod) DO UPDATE SET
          cst = excluded.cst, cclasstrib = excluded.cclasstrib, vbc = excluded.vbc,
          pibsuf = excluded.pibsuf, predaliq_ibsuf = excluded.predaliq_ibsuf,
          paliqefet_ibsuf = excluded.paliqefet_ibsuf, vibsuf = excluded.vibsuf,
          pcbs = excluded.pcbs, predaliq_cbs = excluded.predaliq_cbs,
          paliqefet_cbs = excluded.paliqefet_cbs, vcbs = excluded.vcbs,
          codcclass_trib_ncm = excluded.codcclass_trib_ncm`.execute(db);

      tot.vbc = r2(tot.vbc + vbc);
      tot.ibsuf = r2(tot.ibsuf + vibsuf);
      tot.ibsmun = r2(tot.ibsmun + vibsmun);
      tot.cbs = r2(tot.cbs + vcbs);
      linhas.push({
        codnfprod: Number(i.codnfprod), codproduto: Number(i.codproduto),
        cst: i.cst ?? null, cclasstrib: i.class_trib ?? null, vbc,
        pibsuf: pIbsUf, predaliq_ibsuf: redIbs, paliqefet_ibsuf: efIbsUf, vibsuf,
        pcbs: pCbs, predaliq_cbs: redCbs, paliqefet_cbs: efCbs, vcbs,
        sem_classificacao: semClassificacao,
      });
    }

    // `VIBS = VIBSUF + VIBSMUN` — exato em 10.012 de 10.012 notas do cliente
    const vibs = r2(tot.ibsuf + tot.ibsmun);
    await sql`
      INSERT INTO nf_ibscbs (codnf, idempresa, vbcibscbs, vibsuf, vibsmun, vibs, vcbs)
      VALUES (${d.codnf}, ${empresaId}, ${tot.vbc}, ${tot.ibsuf}, ${tot.ibsmun}, ${vibs}, ${tot.cbs})
      ON CONFLICT (codnf) DO UPDATE SET
        vbcibscbs = excluded.vbcibscbs, vibsuf = excluded.vibsuf, vibsmun = excluded.vibsmun,
        vibs = excluded.vibs, vcbs = excluded.vcbs`.execute(db);

    return {
      codnf: d.codnf, uf: nf.uf, aliquota: { ibsuf: pIbsUf, cbs: pCbs },
      totais: { vbcibscbs: tot.vbc, vibsuf: tot.ibsuf, vibsmun: tot.ibsmun, vibs, vcbs: tot.cbs },
      itens: linhas, sem_classificacao: semClasse,
    };
  }

  /**
   * Os grupos de uma nota, com o par de conferência lado a lado. `so_divergentes` traz só o que a
   * conferência mudou em relação ao XML do fornecedor — no cliente são 36.278 itens (R$ 4,9 milhões de
   * base) e 9.530 reclassificações de CST, das quais 7.753 de 000 para 200.
   */
  async consultar(q: NfIbsCbsConsultaDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const empresaId = this.emp();
    const cab = (await sql<Record<string, unknown>>`
        SELECT h.* FROM nf_ibscbs h WHERE h.codnf = ${q.codnf} AND h.idempresa = ${empresaId}`
      .execute(db)).rows[0];
    const itens = (await sql<Record<string, unknown>>`
        SELECT g.*, p.nroitem, p.descricao, t.nome_class_trib
          FROM nf_prod_ibscbs g
          LEFT JOIN nf_prod p ON p.codnfprod = g.codnfprod
          LEFT JOIN class_trib t ON t.class_trib = g.cclasstrib AND coalesce(t.indr, 'I') <> 'E'
         WHERE g.codnf = ${q.codnf} AND g.idempresa = ${empresaId}
           AND (NOT ${q.so_divergentes}::boolean
                OR (g.cst_ori IS NOT NULL
                    AND (g.cst_ori IS DISTINCT FROM g.cst
                         OR g.cclasstrib_ori IS DISTINCT FROM g.cclasstrib
                         OR g.vbc_ori IS DISTINCT FROM g.vbc)))
         ORDER BY p.nroitem, g.codnfprod`.execute(db)).rows;

    const n = (v: unknown) => (v == null ? null : Number(v));
    return {
      cabecalho: cab == null ? null : {
        codnf: Number(cab.codnf), vbcibscbs: num(cab.vbcibscbs), vibsuf: num(cab.vibsuf),
        vibsmun: num(cab.vibsmun), vibs: num(cab.vibs), vcbs: num(cab.vcbs),
        vdif: num(cab.vdif), vdevtrib: num(cab.vdevtrib), vcredpres: num(cab.vcredpres),
        vcredprescondsus: num(cab.vcredprescondsus),
        // a identidade que o cliente cumpre em 10.012/10.012 — se quebrar aqui, o cabeçalho está podre
        ibs_fecha: r2(num(cab.vibsuf) + num(cab.vibsmun)) === r2(num(cab.vibs)),
      },
      itens: itens.map((g) => ({
        codnfprod: Number(g.codnfprod), nroitem: n(g.nroitem), descricao: g.descricao ?? null,
        codproduto: Number(g.codproduto), cst: g.cst ?? null, cclasstrib: g.cclasstrib ?? null,
        nome_class_trib: g.nome_class_trib ?? null,
        vbc: num(g.vbc), pibsuf: n(g.pibsuf), predaliq_ibsuf: n(g.predaliq_ibsuf),
        paliqefet_ibsuf: n(g.paliqefet_ibsuf), vibsuf: num(g.vibsuf),
        pcbs: n(g.pcbs), predaliq_cbs: n(g.predaliq_cbs), paliqefet_cbs: n(g.paliqefet_cbs),
        vcbs: num(g.vcbs),
        cst_ori: g.cst_ori ?? null, cclasstrib_ori: g.cclasstrib_ori ?? null, vbc_ori: n(g.vbc_ori),
        divergencias: [
          g.cst_ori != null && g.cst_ori !== g.cst ? 'cst' : null,
          g.cclasstrib_ori != null && g.cclasstrib_ori !== g.cclasstrib ? 'cclasstrib' : null,
          g.vbc_ori != null && r2(num(g.vbc_ori)) !== r2(num(g.vbc)) ? 'vbc' : null,
        ].filter((x): x is string => x != null),
      })),
    };
  }
}
