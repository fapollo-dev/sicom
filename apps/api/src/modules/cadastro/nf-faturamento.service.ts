import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = any;
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/**
 * NF — Fase 4: FATURAMENTO (geração de títulos financeiros). Efeito de DINHEIRO.
 *
 * A NF gera N parcelas como títulos em ARECEBER (saída) / APAGAR (entrada), vinculados por
 * `idnf = codnf`, numa ÚNICA transação atômica (no legado os títulos eram criados FORA da
 * transação do estoque — não-atômico; aqui staging+título nascem juntos ou nada nasce).
 *
 * Invariante que protege o dinheiro: **Σ parcelas == base, ao centavo** — rateio em CENTAVOS
 * com a sobra na ÚLTIMA parcela. (A fórmula exata de BuildParcelas vive em FuncoesApollo.pas,
 * ausente do checkout; a colocação da sobra e o formato de duplicata modelo 01 ficam pendentes
 * de golden — não é risco de valor, a soma fecha.)
 *
 * Modalidade: TIPO='E' → APAGAR; 'S' → ARECEBER. Base (corte 1) = TOTALNF. Idempotente
 * (flag nf.faturada + CAS + checagem por idnf). Estorno bloqueado se houver título quitado.
 *
 * Adiado (F4b/F5, dossiê §10): CAIXA/CX_APAGAR, gate automático por CFOP, retenções/funrural/
 * acordo, deduções da base, NF_FORMA_PAGAMENTO, agrupamento, contábil/DIARIO.
 */
@Injectable()
export class NfFaturamentoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  /**
   * Carrega a NF sob lock + valida que pode faturar (mesmas travas p/ o F4 computado e o corte-4 por
   * duplicatas do XML): existe, não cancelada/denegada/contabilizada/faturada, sem título por idnf.
   * Devolve a NF, a tabela alvo (APAGAR entrada / ARECEBER saída) e o txjuros padrão da empresa.
   */
  private async carregarNfFaturavel(
    trx: AnyDB,
    codnf: number,
    emp: number,
  ): Promise<{ nf: any; tabela: 'areceber' | 'apagar'; txjuros: number }> {
    const nf = await trx
      .selectFrom('nf')
      .select(['codnf', 'tipo', 'nronf', 'cancelada', 'faturada', 'contabilizado', 'codparceiro', 'totalnf', 'dtemissao', 'dtcontabil', 'statusnfe', 'icms_st_apagar'])
      .where('codnf', '=', codnf)
      .where('idempresa', '=', emp)
      .forUpdate()
      .executeTakeFirst();
    if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
    if (nf.cancelada === 'S' || nf.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA', { codnf });
    if (nf.statusnfe === 'D') throw new BusinessRuleError('NF_DENEGADA', { codnf });
    if (nf.contabilizado === 'S') throw new BusinessRuleError('NF_CONTABILIZADA', { codnf });
    if (nf.faturada === 'S') throw new BusinessRuleError('NF_JA_FATURADA', { codnf });
    const tabela: 'areceber' | 'apagar' = nf.tipo === 'E' ? 'apagar' : 'areceber';
    const ja = await trx.selectFrom(tabela).select('idnf').where('idnf', '=', codnf).where('codempresa', '=', emp).executeTakeFirst();
    if (ja) throw new BusinessRuleError('NF_JA_FATURADA', { codnf });
    const empFin = await trx.selectFrom('empresas').select('txjuropadrao').where('idempresa', '=', emp).executeTakeFirst();
    return { nf, tabela, txjuros: num(empFin?.txjuropadrao) };
  }

  /** insere UM título (fonte única do shape de coluna de areceber/apagar — evita drift entre os caminhos). */
  private async inserirTituloFat(
    trx: AnyDB,
    tabela: 'areceber' | 'apagar',
    row: { codparceiro: number; codempresa: number; idnf: number; dtvenda: unknown; dtvenc: string; duplicata: string; nrodup: number; valor: number; txjuros: number; tipodoc?: string },
  ): Promise<void> {
    await trx.insertInto(tabela).values({ ...row, quitada: 'N', consiliado: 'N' }).execute();
  }

  /**
   * Corte-4c — título 'RESIDUAL ST' (ICMS-ST a recolher pela loja) a partir de `nf.icms_st_apagar`.
   * Só ENTRADA (APAGAR). 1 título por NF quando icms_st_apagar>0 (gate golden `if TOTALICM_STEXTERNO>0`).
   * Shape golden-exato (PINHEIRAO, 177 títulos): TIPODOC='RESIDUAL ST', RETENCAO='ICMSST', GERADO='SISTEMA',
   * ORIGEM='N', À VISTA (DTVENC=DTVENDA=data do documento), IDNF=codnf, mesmo CODPARCEIRO da NF, OBS no formato
   * do legado (udmNF.pas:8514). Idempotente: não duplica se já existir RESIDUAL ST por (idnf, tipodoc).
   * Roda DENTRO da trx do faturamento (nasce junto dos títulos do fornecedor; o estorno por idnf já o remove).
   */
  private async gerarTituloStResidual(
    trx: AnyDB,
    nf: { codnf: number; tipo: string; nronf?: unknown; codparceiro: number; totalnf: unknown; dtcontabil: unknown; icms_st_apagar?: unknown },
    emp: number,
  ): Promise<number> {
    if (nf.tipo !== 'E') return 0; // ST residual só existe na ENTRADA (recolhimento pela loja)
    const val = num(nf.icms_st_apagar);
    if (val <= 0) return 0;
    // idempotência: não regravar se já houver RESIDUAL ST desta NF.
    const ja = await trx
      .selectFrom('apagar')
      .select('codapg')
      .where('idnf', '=', nf.codnf)
      .where('codempresa', '=', emp)
      .where('tipodoc', '=', 'RESIDUAL ST')
      .executeTakeFirst();
    if (ja) return 0;
    const totalnf = num(nf.totalnf);
    const nronf = String(nf.nronf ?? nf.codnf);
    // OBS verbatim do legado (udmNF.pas:8514-8516) — FormatFloat('0.00') pt-BR ⇒ VÍRGULA decimal (golden byte-a-byte
    // usa '629,18', não '629.18'). ALIQUOTA 0,00% pois o ST vem por MVA, não por alíquota fixa.
    const obs =
      'REF. À RETENÇÕES DE IMPOSTOS. IMPOSTO: ICMSST\n' +
      `NOTA FISCAL NRO: ${nronf}\n` +
      `VALOR NOTA FISCAL: ${totalnf.toFixed(2).replace('.', ',')}\n` +
      'ALIQUOTA ICMSST: 0,00%';
    await trx
      .insertInto('apagar')
      .values({
        codparceiro: nf.codparceiro,
        codempresa: emp,
        idnf: nf.codnf,
        // golden: pDataCompra=cdsNotaDTCONTABIL (udmNF.pas:8509) e à vista DTVENC=DTCOMPRA (0 dias). No golden
        // DTVENC=DTCONTABIL em 98% (não DTEMISSAO — que difere da contábil em ~82% das entradas). dtcontabil
        // volta do pg como Date → normaliza p/ 'YYYY-MM-DD' no dtvenc.
        dtvenda: nf.dtcontabil,
        dtvenc: new Date(nf.dtcontabil as string | number | Date).toISOString().slice(0, 10),
        duplicata: nronf.slice(0, 20), // golden: DUPLICATA=NRONF (GeraApagar iif(pNroNf<>'',pNroNf,...))
        nrodup: 1,
        valor: val,
        txjuros: 0,
        tipodoc: 'RESIDUAL ST',
        retencao: 'ICMSST',
        origem: 'N',
        gerado: 'SISTEMA',
        obs,
        quitada: 'N',
        consiliado: 'N',
      })
      .execute();
    return 1;
  }

  /** flip idempotente nf.faturada 'N'→'S' (CAS) — 0 linhas ⇒ corrida perdida (já faturada). */
  private async marcarFaturada(trx: AnyDB, codnf: number, emp: number, op: number | null): Promise<void> {
    const r = await trx
      .updateTable('nf')
      .set({ faturada: 'S', usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codnf', '=', codnf).where('idempresa', '=', emp).where('faturada', '=', 'N')
      .executeTakeFirst();
    if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('NF_JA_FATURADA', { codnf });
  }

  async faturar(
    codnf: number,
    p: { numParcelas: number; primeiroVencimento: string; intervaloDias: number },
  ): Promise<{ codnf: number; tabela: 'areceber' | 'apagar'; parcelas: number }> {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    if (!(p.numParcelas >= 1 && p.numParcelas <= 200)) throw new BusinessRuleError('NUM_PARCELAS_INVALIDO');

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const { nf, tabela, txjuros } = await this.carregarNfFaturavel(trx, codnf, emp);

      const totalCents = Math.round(num(nf.totalnf) * 100); // base em CENTAVOS
      if (totalCents <= 0) throw new BusinessRuleError('NF_SEM_VALOR', { codnf });

      // rateio: base por parcela + sobra na ÚLTIMA → Σ == totalCents exatamente.
      const baseCents = Math.floor(totalCents / p.numParcelas);
      const resto = totalCents - baseCents * p.numParcelas;
      const venc0 = new Date(`${p.primeiroVencimento}T00:00:00Z`); // UTC (não escorrega 1 dia)
      const dtdoc = nf.tipo === 'E' ? nf.dtemissao : nf.dtcontabil; // APAGAR=emissão / ARECEBER=contábil

      for (let i = 0; i < p.numParcelas; i++) {
        const cents = baseCents + (i === p.numParcelas - 1 ? resto : 0);
        const dt = new Date(venc0);
        dt.setUTCDate(dt.getUTCDate() + i * p.intervaloDias);
        await this.inserirTituloFat(trx, tabela, {
          codparceiro: nf.codparceiro,
          codempresa: emp,
          idnf: codnf,
          dtvenda: dtdoc,
          dtvenc: dt.toISOString().slice(0, 10),
          // golden: "<NRONF> - NNN/NNN"; NRODUP=total de parcelas; nronf pode faltar em rascunho → codnf.
          duplicata: `${nf.nronf ?? codnf} - ${String(i + 1).padStart(3, '0')}/${String(p.numParcelas).padStart(3, '0')}`,
          nrodup: p.numParcelas,
          valor: cents / 100,
          txjuros,
        });
      }

      // corte-4c: título RESIDUAL ST (ICMS-ST a recolher) junto do faturamento — só entrada, só se >0.
      await this.gerarTituloStResidual(trx, nf, emp);

      await this.marcarFaturada(trx, codnf, emp, op);
      return { codnf, tabela, parcelas: p.numParcelas };
    });
  }

  /**
   * Corte-4 — faturar a partir das DUPLICATAS EXPLÍCITAS do XML (`<cobr><dup>`): 1 título por `<dup>`,
   * `valor=vDup`, `dtvenc=dVenc` (VERBATIM, sem rateio — as parcelas reais do fornecedor). Reusa as mesmas
   * travas + txjuros + flip faturada do F4. `duplicata` = o nDup real do fornecedor (fallback formato F4).
   * Chamado pelo import (auto-on-import, fiel a NFe.pas:3457) quando há duplicatas. Estorno = o mesmo
   * `estornarFaturamento` (delete por idnf) — os títulos são idênticos em forma aos do F4.
   */
  async faturarComParcelas(
    codnf: number,
    duplicatas: Array<{ nDup: string; dVenc: string; vDup: number }>,
  ): Promise<{ codnf: number; tabela: 'areceber' | 'apagar'; parcelas: number; total: number }> {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    if (!duplicatas.length) throw new BusinessRuleError('NF_SEM_DUPLICATAS', { codnf });

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const { nf, tabela, txjuros } = await this.carregarNfFaturavel(trx, codnf, emp);
      const N = duplicatas.length;
      const dtdoc = nf.tipo === 'E' ? nf.dtemissao : nf.dtcontabil;
      let totalCents = 0;

      for (let i = 0; i < N; i++) {
        const d = duplicatas[i];
        const cents = Math.round(num(d.vDup) * 100);
        if (cents <= 0) throw new BusinessRuleError('NF_SEM_VALOR', { codnf, parcela: i + 1 }); // parcela tem de ser > 0
        totalCents += cents;
        // nDup = duplicata REAL do fornecedor (mais útil que o NRONF do legado); fallback formato F4.
        // Trunca a 20 (coluna apagar.duplicata varchar(20); NFe permite nDup até 60 — não abortar o import).
        const dup = ((d.nDup && d.nDup.trim()) || `${nf.nronf ?? codnf} - ${String(i + 1).padStart(3, '0')}/${String(N).padStart(3, '0')}`).slice(0, 20);
        await this.inserirTituloFat(trx, tabela, {
          codparceiro: nf.codparceiro,
          codempresa: emp,
          idnf: codnf,
          dtvenda: dtdoc,
          // dVenc já vem 'YYYY-MM-DD' do parser; vazio (raro) → data do documento.
          dtvenc: d.dVenc && d.dVenc.trim() ? d.dVenc.slice(0, 10) : String(dtdoc).slice(0, 10),
          duplicata: dup,
          nrodup: N,
          valor: cents / 100,
          txjuros,
          tipodoc: 'BOLETO', // faturamento por duplicata do XML = boleto (fiel ao GeraApagar do legado)
        });
      }
      if (totalCents <= 0) throw new BusinessRuleError('NF_SEM_VALOR', { codnf });

      // corte-4c: título RESIDUAL ST (ICMS-ST a recolher) junto do faturamento — só entrada, só se >0.
      await this.gerarTituloStResidual(trx, nf, emp);

      await this.marcarFaturada(trx, codnf, emp, op);
      return { codnf, tabela, parcelas: N, total: totalCents / 100 };
    });
  }

  async estornarFaturamento(codnf: number): Promise<void> {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');

    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = await trx
        .selectFrom('nf')
        .select(['codnf', 'tipo', 'faturada', 'contabilizado'])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      if (nf.faturada !== 'S') throw new BusinessRuleError('NF_NAO_FATURADA', { codnf });
      // estorno bloqueado se já contabilizada (uNF.pas:8951 — espelha a guarda do reverter).
      if (nf.contabilizado === 'S') throw new BusinessRuleError('NF_CONTABILIZADA', { codnf });

      const tabela = nf.tipo === 'E' ? 'apagar' : 'areceber';

      // trava: não estornar se algum título já foi quitado (espelha VerificaExisteBaixas; corte 1).
      const quit = await trx
        .selectFrom(tabela)
        .select('idnf')
        .where('idnf', '=', codnf)
        .where('codempresa', '=', emp)
        .where('quitada', '=', 'S')
        .executeTakeFirst();
      if (quit) throw new BusinessRuleError('TITULO_QUITADO', { codnf });

      await trx.deleteFrom(tabela).where('idnf', '=', codnf).where('codempresa', '=', emp).execute();

      const r = await trx
        .updateTable('nf')
        .set({ faturada: 'N', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .where('faturada', '=', 'S')
        .executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('NF_NAO_FATURADA', { codnf });
    });
  }

  /**
   * Estorno do financeiro DENTRO da transação do CANCELAMENTO da NFe (F6→F4b). Espelha
   * `CancelaFaturamento` (uNF.pas:6668) quando `ESTORNA_FINANCEIRO_NF='S'`: exclui os títulos
   * (`ExcluiFaturamento`) e reabre `nf.faturada`. **Best-effort** — se algum título já foi
   * quitado (`VerificaExisteBaixas`, uNF:6683), MANTÉM o financeiro e NÃO aborta o cancelamento
   * fiscal já efetivado (o legado só exibe mensagem / registra pendência). NÃO abre transação
   * própria: usa a `trx` do cancelamento (atômico com o flip P→C). O gate de config e a guarda
   * `faturada='S'` são responsabilidade do chamador (nf-nfe.cancelar). Retorna o desfecho.
   */
  async estornarNoCancelamento(
    trx: AnyDB,
    codnf: number,
    tipo: string,
    emp: number,
    op: number | null,
  ): Promise<'estornado' | 'mantido-quitado' | 'sem-financeiro'> {
    const tabela = tipo === 'E' ? 'apagar' : 'areceber';
    const existe = await trx
      .selectFrom(tabela)
      .select('idnf')
      .where('idnf', '=', codnf)
      .where('codempresa', '=', emp)
      .executeTakeFirst();
    if (!existe) return 'sem-financeiro';
    const quit = await trx
      .selectFrom(tabela)
      .select('idnf')
      .where('idnf', '=', codnf)
      .where('codempresa', '=', emp)
      .where('quitada', '=', 'S')
      .executeTakeFirst();
    if (quit) return 'mantido-quitado'; // título baixado → não exclui (pendência); cancelamento segue
    await trx.deleteFrom(tabela).where('idnf', '=', codnf).where('codempresa', '=', emp).execute();
    await trx
      .updateTable('nf')
      .set({ faturada: 'N', usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codnf', '=', codnf)
      .where('idempresa', '=', emp)
      .execute();
    return 'estornado';
  }
}
