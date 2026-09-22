import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ApuracaoIbsCbsObterDto, ApuracaoIbsCbsProcessarDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * APURAÇÃO DE IBS/CBS — corte-3 da reforma. Migration 281. Dossiê `uCadIBSCBS.md` §13.
 *
 * DESENVOLVIDO (novo): o legado não apura IBS/CBS, só grava os grupos na nota — não há tela, tabela nem
 * coluna de saldo em lugar nenhum do Oracle. O substrato existe e é grande: ~700 notas de entrada por mês
 * trazendo crédito e ~90 de saída gerando débito.
 *
 * ⚠️ A REGRA ESTRUTURAL: **IBS e CBS se apuram SEPARADAMENTE e um não compensa o outro.** A CBS é federal
 * (substitui PIS e COFINS); o IBS é dos Estados e Municípios (substitui ICMS e ISS). São entes tributantes
 * diferentes. Nada aqui soma os dois: cada um tem seu débito, seu crédito, seu saldo anterior e seu saldo
 * a transportar. No cliente as ordens de grandeza confirmam por que isso importa — em 2026-01 o crédito de
 * IBS é R$ 1.530,42 e o de CBS é R$ 13.745,12.
 */
@Injectable()
export class ApuracaoIbsCbsService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private periodo(competencia: string) {
    const ano = Number(competencia.slice(0, 4));
    const mes = Number(competencia.slice(4));
    const ini = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const fimD = new Date(Date.UTC(ano, mes, 0));   // dia 0 do mês seguinte = último dia deste
    const fim = fimD.toISOString().slice(0, 10);
    return { ini, fim };
  }

  /** a competência imediatamente anterior, para buscar o saldo credor que transita */
  private anterior(competencia: string) {
    const ano = Number(competencia.slice(0, 4));
    const mes = Number(competencia.slice(4));
    const a = mes === 1 ? ano - 1 : ano;
    const m = mes === 1 ? 12 : mes - 1;
    return `${a}${String(m).padStart(2, '0')}`;
  }

  /**
   * Soma os grupos das notas do período, por direção.
   *
   * Os filtros são os mesmos da apuração de ICMS (mig 152) porque a razão é a mesma: data **CONTÁBIL**,
   * `PROC='S'`, não cancelada e não denegada. Nota cancelada ou denegada não gera débito nem crédito.
   */
  private async somaPorDirecao(trx: AnyDB, emp: number, dir: 'E' | 'S', ini: string, fim: string) {
    return (await sql<Record<string, unknown>>`
        SELECT f.codnf,
               sum(g.vbc)                              AS base,
               sum(coalesce(g.vibsuf, 0) + coalesce(g.vibsmun, 0)) AS ibs,
               sum(coalesce(g.vcbs, 0))                AS cbs,
               count(*)                                AS itens
          FROM nf_prod_ibscbs g
          JOIN nf f ON f.codnf = g.codnf
         WHERE g.idempresa = ${emp}
           AND f.tipo = ${dir}
           AND f.dtcontabil >= ${ini}::date AND f.dtcontabil <= ${fim}::date
           AND coalesce(f.proc, 'S') = 'S'
           AND coalesce(f.cancelada, 'N') <> 'S'
           AND coalesce(f.statusnfe, '') <> 'D'
         GROUP BY f.codnf`.execute(trx)).rows;
  }

  async processar(dto: ApuracaoIbsCbsProcessarDto) {
    const emp = this.emp();
    const { ini, fim } = this.periodo(dto.competencia);
    const db = this.dbp.forTenant() as AnyDB;

    return db.transaction().execute(async (trx: AnyDB) => {
      const ja = (await sql<{ codapuracao_ibscbs: number; fechada: string }>`
          SELECT codapuracao_ibscbs, fechada FROM apuracao_ibscbs
           WHERE idempresa = ${emp} AND competencia = ${dto.competencia} FOR UPDATE`.execute(trx)).rows[0];
      // apuração fechada é documento: não se reprocessa nem com pedido explícito
      if (ja && ja.fechada === 'S')
        throw new BusinessRuleError('APURACAO_IBSCBS_FECHADA', { competencia: dto.competencia });
      if (ja && !dto.reprocessar)
        throw new BusinessRuleError('APURACAO_IBSCBS_JA_EXISTE', {
          competencia: dto.competencia, codapuracao_ibscbs: Number(ja.codapuracao_ibscbs),
        });

      const entradas = await this.somaPorDirecao(trx, emp, 'E', ini, fim);
      const saidas = await this.somaPorDirecao(trx, emp, 'S', ini, fim);

      const soma = (rows: Array<Record<string, unknown>>) => rows.reduce<{ base: number; ibs: number; cbs: number }>(
        (a, r) => ({
          base: r2(a.base + num(r.base)), ibs: r2(a.ibs + num(r.ibs)), cbs: r2(a.cbs + num(r.cbs)),
        }), { base: 0, ibs: 0, cbs: 0 });
      const cred = soma(entradas);
      const deb = soma(saidas);

      // ⚠️ o saldo anterior vem do período anterior FECHADO, e vem SEPARADO por tributo
      const ant = (await sql<{ ibs_saldo_credor: number; cbs_saldo_credor: number }>`
          SELECT ibs_saldo_credor, cbs_saldo_credor FROM apuracao_ibscbs
           WHERE idempresa = ${emp} AND competencia = ${this.anterior(dto.competencia)}
             AND fechada = 'S'`.execute(trx)).rows[0];
      const ibsAnt = num(ant?.ibs_saldo_credor);
      const cbsAnt = num(ant?.cbs_saldo_credor);

      // ⚠️ cada tributo fecha a SUA conta. Nunca `(ibsDeb + cbsDeb) - (ibsCred + cbsCred)`.
      const ibsDif = r2(deb.ibs - cred.ibs - ibsAnt);
      const cbsDif = r2(deb.cbs - cred.cbs - cbsAnt);
      const res = {
        ibs_a_recolher: ibsDif > 0 ? ibsDif : 0, ibs_saldo_credor: ibsDif < 0 ? r2(-ibsDif) : 0,
        cbs_a_recolher: cbsDif > 0 ? cbsDif : 0, cbs_saldo_credor: cbsDif < 0 ? r2(-cbsDif) : 0,
      };

      const cab = (await sql<{ codapuracao_ibscbs: number }>`
        INSERT INTO apuracao_ibscbs (idempresa, competencia, data_inicio, data_fim,
              base_debito, ibs_debito, cbs_debito, notas_debito,
              base_credito, ibs_credito, cbs_credito, notas_credito,
              ibs_saldo_anterior, cbs_saldo_anterior,
              ibs_a_recolher, ibs_saldo_credor, cbs_a_recolher, cbs_saldo_credor,
              codoperador, dtultimalteracao)
        VALUES (${emp}, ${dto.competencia}, ${ini}::date, ${fim}::date,
                ${deb.base}, ${deb.ibs}, ${deb.cbs}, ${saidas.length},
                ${cred.base}, ${cred.ibs}, ${cred.cbs}, ${entradas.length},
                ${ibsAnt}, ${cbsAnt},
                ${res.ibs_a_recolher}, ${res.ibs_saldo_credor},
                ${res.cbs_a_recolher}, ${res.cbs_saldo_credor},
                ${currentTenant().operadorId ?? null}, now())
        ON CONFLICT (idempresa, competencia) DO UPDATE SET
          data_inicio = excluded.data_inicio, data_fim = excluded.data_fim,
          base_debito = excluded.base_debito, ibs_debito = excluded.ibs_debito,
          cbs_debito = excluded.cbs_debito, notas_debito = excluded.notas_debito,
          base_credito = excluded.base_credito, ibs_credito = excluded.ibs_credito,
          cbs_credito = excluded.cbs_credito, notas_credito = excluded.notas_credito,
          ibs_saldo_anterior = excluded.ibs_saldo_anterior,
          cbs_saldo_anterior = excluded.cbs_saldo_anterior,
          ibs_a_recolher = excluded.ibs_a_recolher, ibs_saldo_credor = excluded.ibs_saldo_credor,
          cbs_a_recolher = excluded.cbs_a_recolher, cbs_saldo_credor = excluded.cbs_saldo_credor,
          codoperador = excluded.codoperador, dtultimalteracao = now()
        RETURNING codapuracao_ibscbs`.execute(trx)).rows[0];
      const cod = Number(cab.codapuracao_ibscbs);

      await sql`DELETE FROM apuracao_ibscbs_nf WHERE codapuracao_ibscbs = ${cod}`.execute(trx);
      for (const [dir, rows] of [['E', entradas], ['S', saidas]] as const) {
        for (const r of rows) {
          await sql`
            INSERT INTO apuracao_ibscbs_nf (codapuracao_ibscbs, codnf, direcao, base, ibs, cbs, itens)
            VALUES (${cod}, ${r.codnf}, ${dir}, ${r2(num(r.base))}, ${r2(num(r.ibs))},
                    ${r2(num(r.cbs))}, ${Number(r.itens)})`.execute(trx);
        }
      }

      return {
        codapuracao_ibscbs: cod, competencia: dto.competencia, data_inicio: ini, data_fim: fim,
        credito: { ...cred, notas: entradas.length },
        debito: { ...deb, notas: saidas.length },
        saldo_anterior: { ibs: ibsAnt, cbs: cbsAnt },
        resultado: res,
        // o limite declarado, na própria resposta: quem lê o número tem de saber o que ele não cobre
        observacao: 'o débito de cupom (NFC-e) não entra: nenhuma venda de cupom carrega grupo IBS/CBS',
      };
    });
  }

  async obter(dto: ApuracaoIbsCbsObterDto) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const cab = (await sql<Record<string, unknown>>`
        SELECT * FROM apuracao_ibscbs
         WHERE idempresa = ${emp}
           AND (${dto.competencia ?? ''}::text = '' OR competencia = ${dto.competencia ?? ''})
         ORDER BY competencia DESC
         LIMIT ${dto.competencia ? 1 : 24}`.execute(db)).rows;
    if (!cab.length) return { apuracoes: [], detalhe: [] };

    const cod = Number(cab[0].codapuracao_ibscbs);
    const det = (await sql<Record<string, unknown>>`
        SELECT d.*, f.nronf, f.serie, f.dtcontabil, p.razao AS parceiro
          FROM apuracao_ibscbs_nf d
          LEFT JOIN nf f ON f.codnf = d.codnf
          LEFT JOIN parceiros p ON p.codparceiro = f.codparceiro AND p.idempresa = f.idempresa
         WHERE d.codapuracao_ibscbs = ${cod}
         ORDER BY d.direcao, d.ibs + d.cbs DESC
         LIMIT ${dto.limite_detalhe}`.execute(db)).rows;

    const n = (r: Record<string, unknown>, k: string) => num(r[k]);
    return {
      apuracoes: cab.map((r) => ({
        codapuracao_ibscbs: Number(r.codapuracao_ibscbs), competencia: r.competencia,
        data_inicio: r.data_inicio, data_fim: r.data_fim, fechada: r.fechada,
        base_debito: n(r, 'base_debito'), ibs_debito: n(r, 'ibs_debito'), cbs_debito: n(r, 'cbs_debito'),
        notas_debito: Number(r.notas_debito),
        base_credito: n(r, 'base_credito'), ibs_credito: n(r, 'ibs_credito'),
        cbs_credito: n(r, 'cbs_credito'), notas_credito: Number(r.notas_credito),
        ibs_saldo_anterior: n(r, 'ibs_saldo_anterior'), cbs_saldo_anterior: n(r, 'cbs_saldo_anterior'),
        ibs_a_recolher: n(r, 'ibs_a_recolher'), ibs_saldo_credor: n(r, 'ibs_saldo_credor'),
        cbs_a_recolher: n(r, 'cbs_a_recolher'), cbs_saldo_credor: n(r, 'cbs_saldo_credor'),
      })),
      detalhe: det.map((r) => ({
        codnf: Number(r.codnf), direcao: r.direcao, nronf: r.nronf ?? null, serie: r.serie ?? null,
        dtcontabil: r.dtcontabil ?? null, parceiro: r.parceiro ?? null,
        base: n(r, 'base'), ibs: n(r, 'ibs'), cbs: n(r, 'cbs'), itens: Number(r.itens),
      })),
    };
  }

  /** Fecha a competência. Depois disso o saldo credor transita e a apuração não se reprocessa. */
  async fechar(competencia: string) {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      const a = (await sql<{ codapuracao_ibscbs: number; fechada: string }>`
          SELECT codapuracao_ibscbs, fechada FROM apuracao_ibscbs
           WHERE idempresa = ${emp} AND competencia = ${competencia} FOR UPDATE`.execute(trx)).rows[0];
      if (!a) throw new BusinessRuleError('APURACAO_IBSCBS_NAO_ENCONTRADA', { competencia });
      if (a.fechada === 'S') throw new BusinessRuleError('APURACAO_IBSCBS_FECHADA', { competencia });
      await sql`UPDATE apuracao_ibscbs SET fechada = 'S', dtultimalteracao = now()
                 WHERE codapuracao_ibscbs = ${a.codapuracao_ibscbs}`.execute(trx);
      return { codapuracao_ibscbs: Number(a.codapuracao_ibscbs), competencia, fechada: 'S' };
    });
  }
}
