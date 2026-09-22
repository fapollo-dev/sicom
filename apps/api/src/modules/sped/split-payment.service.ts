import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type {
  SplitPaymentConfigDto, SplitPaymentConsultaDto, SplitPaymentGerarDto,
} from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * SPLIT PAYMENT — corte-7 da reforma. Migration 284. Dossiê `uCadIBSCBS.md` §18.
 *
 * DESENVOLVIDO (novo), com a LC 214/2025 (arts. 31 a 35) como fonte e sem dado do cliente para conferir.
 *
 * O split não altera o imposto devido: altera **quem paga e quando**. O imposto é separado na liquidação
 * financeira e vai direto ao fisco, então o vendedor recebe líquido:
 *
 *     valor do título = valor líquido + IBS retido + CBS retido
 *
 * ⚠️ E o retido **abate** o que se recolhe na apuração. Sem isso o contribuinte paga duas vezes — uma na
 * liquidação e outra na guia do período.
 */
@Injectable()
export class SplitPaymentService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async obterConfig() {
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = (await sql<Record<string, unknown>>`
        SELECT * FROM split_payment_config WHERE idempresa = ${this.emp()}`.execute(db)).rows[0];
    return r
      ? { ...r, perc_simplificado: num(r.perc_simplificado) }
      : { idempresa: this.emp(), modalidade: 'inteligente', perc_simplificado: 0, ativo: 'N' };
  }

  async gravarConfig(d: SplitPaymentConfigDto) {
    const emp = this.emp();
    // percentual é obrigatório na simplificada e só nela: sem ele a retenção sairia zero e pareceria
    // "sem split", quando na verdade é configuração incompleta
    if (d.modalidade === 'simplificada' && d.perc_simplificado <= 0)
      throw new BusinessRuleError('SPLIT_PERCENTUAL_OBRIGATORIO', { modalidade: d.modalidade });
    const db = this.dbp.forTenant() as AnyDB;
    await sql`
      INSERT INTO split_payment_config (idempresa, modalidade, perc_simplificado, ativo, vigencia_inicio,
                                        fonte, dtultimalteracao)
      VALUES (${emp}, ${d.modalidade}, ${d.perc_simplificado}, ${d.ativo},
              ${d.vigencia_inicio ?? null}::date, ${d.fonte ?? null}, now())
      ON CONFLICT (idempresa) DO UPDATE SET
        modalidade = excluded.modalidade, perc_simplificado = excluded.perc_simplificado,
        ativo = excluded.ativo, vigencia_inicio = excluded.vigencia_inicio,
        fonte = excluded.fonte, dtultimalteracao = now()`.execute(db);
    return { idempresa: emp, ...d };
  }

  /**
   * Calcula e registra a retenção de uma nota.
   *
   * ⚠️ Só se retém o que é **devido**: item imune, isento, monofásico ou suspenso não gera retenção, porque
   * não gera imposto a pagar naquela operação. Isso sai de graça dos cortes 2 e 6 — a retenção incide sobre
   * `vibsuf + vibsmun` e `vcbs` efetivamente apurados, que já são zero nesses casos. O suspenso é o exemplo
   * de por que não se pode reter: o imposto existe e não é devido agora.
   */
  async gerar(d: SplitPaymentGerarDto) {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;

    return db.transaction().execute(async (trx: AnyDB) => {
      const cfg = (await sql<Record<string, unknown>>`
          SELECT modalidade, perc_simplificado, ativo FROM split_payment_config
           WHERE idempresa = ${emp}`.execute(trx)).rows[0];
      if (!cfg || cfg.ativo !== 'S')
        throw new BusinessRuleError('SPLIT_NAO_ATIVO', { idempresa: emp });
      const modalidade = String(cfg.modalidade);

      const nf = (await sql<Record<string, unknown>>`
          SELECT f.codnf, f.tipo, f.totalnf, to_char(coalesce(f.dtcontabil, f.dtemissao), 'YYYYMM') AS comp,
                 h.vibs, h.vcbs, h.vbcibscbs
            FROM nf f
            LEFT JOIN nf_ibscbs h ON h.codnf = f.codnf AND h.idempresa = f.idempresa
           WHERE f.codnf = ${d.codnf} AND f.idempresa = ${emp}`.execute(trx)).rows[0];
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf: d.codnf });
      if (nf.vibs == null && nf.vcbs == null)
        throw new BusinessRuleError('NF_SEM_GRUPO_IBSCBS', { codnf: d.codnf });

      const valorOperacao = r2(num(nf.totalnf));
      let ibs = 0, cbs = 0;
      if (modalidade === 'inteligente') {
        // (a) o valor exato do documento — é o caso normal, e o único em que o retido bate com o imposto
        ibs = r2(num(nf.vibs)); cbs = r2(num(nf.vcbs));
      } else if (modalidade === 'simplificada') {
        // (b) percentual sobre o valor da operação; a diferença se acerta na apuração
        const p = num(cfg.perc_simplificado);
        const total = r2((valorOperacao * p) / 100);
        // rateado entre os dois tributos na proporção do imposto do documento — se não houver imposto
        // no documento, não há o que ratear e a retenção é zero
        const soma = r2(num(nf.vibs) + num(nf.vcbs));
        ibs = soma > 0 ? r2((total * num(nf.vibs)) / soma) : 0;
        cbs = soma > 0 ? r2(total - ibs) : 0;
      } else {
        // (c) manual: o contribuinte informa
        if (d.ibs_manual == null && d.cbs_manual == null)
          throw new BusinessRuleError('SPLIT_MANUAL_SEM_VALOR', { codnf: d.codnf });
        ibs = r2(num(d.ibs_manual)); cbs = r2(num(d.cbs_manual));
        // não se separa mais do que é devido no documento
        if (ibs > r2(num(nf.vibs)) + 0.005 || cbs > r2(num(nf.vcbs)) + 0.005)
          throw new BusinessRuleError('SPLIT_MANUAL_EXCEDE', {
            codnf: d.codnf, informado: { ibs, cbs },
            devido: { ibs: r2(num(nf.vibs)), cbs: r2(num(nf.vcbs)) },
          });
      }

      const liquido = r2(valorOperacao - ibs - cbs);
      const r = (await sql<{ codsplit: number }>`
        INSERT INTO split_payment (idempresa, codnf, direcao, modalidade, valor_operacao,
                                   ibs_retido, cbs_retido, valor_liquido, competencia, codoperador)
        VALUES (${emp}, ${d.codnf}, ${nf.tipo}, ${modalidade}, ${valorOperacao},
                ${ibs}, ${cbs}, ${liquido}, ${nf.comp}, ${currentTenant().operadorId ?? null})
        ON CONFLICT (codnf, direcao) DO UPDATE SET
          modalidade = excluded.modalidade, valor_operacao = excluded.valor_operacao,
          ibs_retido = excluded.ibs_retido, cbs_retido = excluded.cbs_retido,
          valor_liquido = excluded.valor_liquido, competencia = excluded.competencia
        RETURNING codsplit`.execute(trx)).rows[0];

      return {
        codsplit: Number(r.codsplit), codnf: d.codnf, direcao: nf.tipo, modalidade,
        valor_operacao: valorOperacao, ibs_retido: ibs, cbs_retido: cbs, valor_liquido: liquido,
        competencia: nf.comp,
        // a identidade que a liquidação tem de respeitar
        confere: r2(liquido + ibs + cbs) === valorOperacao,
      };
    });
  }

  async consultar(q: SplitPaymentConsultaDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await sql<Record<string, unknown>>`
        SELECT s.*, f.nronf, f.serie
          FROM split_payment s
          LEFT JOIN nf f ON f.codnf = s.codnf
         WHERE s.idempresa = ${this.emp()}
           AND (${q.competencia ?? ''}::text = '' OR s.competencia = ${q.competencia ?? ''})
           AND (${q.codnf ?? 0}::int = 0 OR s.codnf = ${q.codnf ?? 0})
         ORDER BY s.competencia DESC, s.codnf
         LIMIT ${q.limite}`.execute(db)).rows;
    const tot = rows.reduce<{ ibs: number; cbs: number; liquido: number }>((a, r) => ({
      ibs: r2(a.ibs + num(r.ibs_retido)), cbs: r2(a.cbs + num(r.cbs_retido)),
      liquido: r2(a.liquido + num(r.valor_liquido)),
    }), { ibs: 0, cbs: 0, liquido: 0 });
    return {
      totais: tot,
      itens: rows.map((r) => ({
        codsplit: Number(r.codsplit), codnf: Number(r.codnf), direcao: r.direcao,
        modalidade: r.modalidade, nronf: r.nronf ?? null, serie: r.serie ?? null,
        valor_operacao: num(r.valor_operacao), ibs_retido: num(r.ibs_retido),
        cbs_retido: num(r.cbs_retido), valor_liquido: num(r.valor_liquido),
        competencia: r.competencia, liquidado: r.liquidado,
      })),
    };
  }
}
