import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { lancarNoDiario, type RegistroDataSet } from './integracao-contabil.motor';

type AnyDB = Kysely<any>;
export type TipoDocumento = 'CP' | 'CR' | 'TRANSF' | 'ADTO' | 'CAIXA' | 'CONVENIO';
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** `TTipoOrigemContabil` (`UIntegracaoContabil.pas:17-27`). */
const ORIGEM: Record<TipoDocumento, number> = { CP: 13, CR: 14, TRANSF: 19, ADTO: 63, CAIXA: 64, CONVENIO: 65 };

export interface ResultadoDocumentos { documentos: number; lancamentos: number; total: number }

/**
 * INTEGRAÇÃO CONTÁBIL (`FRMTRON`) — corte-3: os lançamentos **POR DOCUMENTO**.
 * `UIntegracaoContabil.pas`: `TIntegracaoContabilContasPagar` :1225 · `…ContasReceber` :3940 ·
 * `TIntegracaoTransferenciaContas` :4283 · `TIntegracaoAdiantamento` :2828 · `TIntegracaoMovimentacaoCaixa`
 * :2585 · `TIntegracaoAgrupamentoConvenio` :3117. Opções 1, 2, 10 e o resto do radio (`uTron.pas:2101`).
 * Motor compartilhado: `integracao-contabil.motor.ts`. Dossiê: `uTron-integracao-contabil.md`.
 *
 * O que muda em relação aos cortes 1 e 2: **a situação vem do próprio documento** (`IDSITUACAO_NF`), não da
 * configuração. É por isso que a origem 13 aparece no razão do cliente com 37 situações distintas e a 64 com
 * 21 — cada conta a pagar, cada movimento de caixa carrega a sua. Só a transferência (2020) e o agrupamento
 * de convênio (910) são fixos na config.
 *
 * Volume no cliente: 19 → 17.581 linhas · 65 → 15.119 · 64 → 7.261 · 14 → 6.711 · 13 → 3.935 · 63 → 547.
 *
 * ⚠️ **divergência consciente — multi-empresa**: como nos cortes anteriores, rodamos na empresa do tenant.
 */
@Injectable()
export class DocumentosContabilService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async assertPeriodoAberto(db: AnyDB, dataFim: string): Promise<void> {
    const cfg = (await db.selectFrom('config_integracao_contabil').select('chaveamento_periodo').executeTakeFirst()) as
      { chaveamento_periodo: unknown } | undefined;
    if (!cfg) throw new BusinessRuleError('CONFIG_INTEGRACAO_NAO_DEFINIDA');
    const chav = cfg.chaveamento_periodo == null ? null : String(cfg.chaveamento_periodo).slice(0, 10);
    if (chav && dataFim <= chav) throw new BusinessRuleError('PERIODO_CONTABIL_CHAVEADO', { ate: chav });
  }

  async integrar(tipo: TipoDocumento, p: { dataIni: string; dataFim: string; codigo?: number | null }): Promise<ResultadoDocumentos> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    await this.assertPeriodoAberto(db, p.dataFim);
    const cfg = (await db.selectFrom('config_integracao_contabil').selectAll().executeTakeFirstOrThrow()) as Record<string, number | null>;
    return db.transaction().execute(async (trx: AnyDB) => {
      switch (tipo) {
        case 'CP': return this.contasPagar(trx, emp, p, cfg);
        case 'CR': return this.contasReceber(trx, emp, p, cfg);
        case 'TRANSF': return this.transferencias(trx, emp, p, cfg);
        case 'ADTO': return this.adiantamentos(trx, emp, p);
        case 'CAIXA': return this.movimentacaoCaixa(trx, emp, p);
        case 'CONVENIO': return this.convenio(trx, emp, p, cfg);
      }
    });
  }

  /**
   * CADASTRO DE CONTAS A PAGAR — origem 13 (`:1268-1440`). O crédito é o FORNECEDOR (uma linha) e o débito é o
   * **rateio por centro de custo** em `CX_APAGAR` (N linhas) — daí o formato variar com o rateio: um centro de
   * custo só sai balanceado, dois ou mais saem em linhas separadas. Confirmado no razão: da situação 464, os
   * 27 títulos com uma linha de rateio saíram balanceados e os 121 com duas saíram single-legged.
   *
   * Cinco exclusões (`:1240-1244`), cada uma com o seu próprio caminho contábil: título agrupado, adiantamento
   * a fornecedor, origem 'B' (boleto), título-filho (`CODAPG_PAI`) e título gerado por nota (`IDNF`).
   */
  private async contasPagar(trx: AnyDB, emp: number, p: { dataIni: string; dataFim: string; codigo?: number | null }, cfg: Record<string, number | null>): Promise<ResultadoDocumentos> {
    const docs = (await sql<Record<string, unknown>>`
      SELECT a.codapg, to_char(a.dtcompra, 'YYYY-MM-DD') AS data, a.codgrupo, a.codparceiro, a.origem, a.idsituacao_nf,
             (a.valor + coalesce(a.vendor,0) - coalesce(a.desconto,0))::numeric(13,2) AS valor,
             p.codcontabil_for::int AS conta_parceiro
        FROM apagar a
        LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro
       WHERE coalesce(a.contabilizado,'N') = 'N'
         AND coalesce(a.agrupamento,'N') = 'N'
         AND coalesce(a.adfornecedor,'N') = 'N'
         AND coalesce(a.origem,'X') <> 'B'
         AND coalesce(a.codapg_pai,0) = 0
         AND coalesce(a.idnf,0) = 0
         AND a.codempresa = ${emp}
         AND ((${p.codigo ?? null}::int IS NOT NULL AND a.codapg = ${p.codigo ?? null}::int)
           OR (${p.codigo ?? null}::int IS NULL AND a.dtcompra BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date))
       ORDER BY a.codapg
    `.execute(trx)).rows;

    let lancamentos = 0;
    let total = 0;
    for (const d of docs) {
      const codapg = Number(d.codapg);
      // a ORIGEM do título pode trocar a situação (`:1320-1327`): recarga, voucher, correspondente, troco solidário.
      const porOrigem: Record<string, string> = { R: 'config_recarga', V: 'config_voucher', C: 'config_correspondente', T: 'config_troco_solidario' };
      const chave = porOrigem[String(d.origem ?? '')];
      const situacao = chave ? cfg[chave] : (d.idsituacao_nf == null ? null : Number(d.idsituacao_nf));
      if (!situacao) throw new BusinessRuleError('SITUACAO_DOCUMENTO_NAO_INFORMADA', { origem: 'CP', documento: codapg });
      if (d.conta_parceiro == null) throw new BusinessRuleError('CONTA_PARCEIRO_NAO_DEFINIDA', { documento: codapg, codparceiro: d.codparceiro });
      if (!d.data) throw new BusinessRuleError('DOCUMENTO_SEM_DATA', { origem: 'CP', documento: codapg });
      const valor = r2(num(d.valor));
      const rateio = await this.rateio(trx, Number(d.codgrupo ?? 0), valor);

      await lancarNoDiario(trx, {
        emp, codorigem: ORIGEM.CP, situacao, data: String(d.data), valor,
        idorigem: codapg, documento: String(codapg), complemento: String(codapg),
        dataSetC: [{ codplanocontas: Number(d.conta_parceiro), valor, descricao: `o parceiro ${d.codparceiro ?? 0}` }],
        dataSetD: rateio,
        desclote: `Conta a pagar ${codapg}`,
      });
      await trx.updateTable('apagar').set({ contabilizado: 'S' }).where('codapg', '=', codapg).execute();
      lancamentos += 1;
      total = r2(total + valor);
    }
    return { documentos: docs.length, lancamentos, total };
  }

  /**
   * O rateio de `CX_APAGAR` (`GetSQLCxApagar` :1258) com o **índice** de `:1357-1377`: quando a soma das linhas
   * não fecha com o valor do título, cada linha é multiplicada por `valor / soma`. Sem rateio o dataset fica
   * vazio — e aí a perna de débito da situação **tem de ser fixa**, senão o legado recusa
   * ("a conta contábil de débito para contas a pagar sem centro de custo deve ser fixa", `:1393`).
   */
  private async rateio(trx: AnyDB, codgrupo: number, valor: number): Promise<RegistroDataSet[]> {
    if (!codgrupo) return [];
    const linhas = (await sql<Record<string, unknown>>`
      SELECT c.codcc, c.valor, pc.codplanocontas, p.descricao
        FROM cx_apagar c
        JOIN plc p ON p.codplc = c.codcc
        LEFT JOIN plano_contas pc ON pc.codplanocontas = p.codcontabil
       WHERE c.codgrupo = ${codgrupo}
       ORDER BY c.codcxapagar
    `.execute(trx)).rows;
    if (!linhas.length) return [];
    const soma = r2(linhas.reduce((s, l) => s + num(l.valor), 0));
    const indice = soma !== 0 && soma !== valor ? valor / soma : 1;
    return linhas.map((l) => ({
      codplanocontas: l.codplanocontas == null ? null : Number(l.codplanocontas),
      valor: r2(num(l.valor) * indice),
      descricao: `o centro de custo ${l.descricao ?? l.codcc}`,
    }));
  }

  /**
   * CADASTRO DE CONTAS A RECEBER — origem 14 (`:4009-4180`). Espelho do CP e mais simples: o débito é o
   * CLIENTE (`PARCEIROS.CODCONTABIL`) e o crédito é a conta do **centro de custo** do recebível
   * (`ARECEBER.CODPLC` → `PLC.CODCONTABIL`). Uma linha de cada lado, sempre — no razão, 6.711 linhas
   * balanceadas e nenhuma single.
   */
  private async contasReceber(trx: AnyDB, emp: number, p: { dataIni: string; dataFim: string; codigo?: number | null }, cfg: Record<string, number | null>): Promise<ResultadoDocumentos> {
    const docs = (await sql<Record<string, unknown>>`
      SELECT a.codrcb, to_char(a.dtvenda, 'YYYY-MM-DD') AS data, a.valor, a.codparceiro, a.codplc, a.idsituacao_nf,
             p.codcontabil::int AS conta_parceiro, pc.codplanocontas AS conta_cc, pl.descricao AS cc_desc
        FROM areceber a
        LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro
        LEFT JOIN plc pl ON pl.codplc = a.codplc
        LEFT JOIN plano_contas pc ON pc.codplanocontas = pl.codcontabil
       WHERE coalesce(a.contabilizado,'N') = 'N'
         AND coalesce(a.agrupamento,'N') = 'N'
         AND coalesce(a.adfornecedor,'N') = 'N'
         AND coalesce(a.origem,'X') NOT IN ('B','F')
         AND coalesce(a.idnf,0) = 0
         AND a.codempresa = ${emp}
         AND ((${p.codigo ?? null}::int IS NOT NULL AND a.codrcb = ${p.codigo ?? null}::int)
           OR (${p.codigo ?? null}::int IS NULL AND a.dtvenda BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date))
       ORDER BY a.codrcb
    `.execute(trx)).rows;

    let lancamentos = 0;
    let total = 0;
    for (const d of docs) {
      const codrcb = Number(d.codrcb);
      const situacao = d.idsituacao_nf == null ? cfg.config_quebracaixarcb : Number(d.idsituacao_nf);
      if (!situacao) throw new BusinessRuleError('SITUACAO_DOCUMENTO_NAO_INFORMADA', { origem: 'CR', documento: codrcb });
      if (!d.data) throw new BusinessRuleError('DOCUMENTO_SEM_DATA', { origem: 'CR', documento: codrcb });
      const valor = r2(num(d.valor));
      await lancarNoDiario(trx, {
        emp, codorigem: ORIGEM.CR, situacao, data: String(d.data), valor,
        idorigem: codrcb, documento: String(codrcb), complemento: String(codrcb),
        dataSetD: [{ codplanocontas: d.conta_parceiro == null ? null : Number(d.conta_parceiro), valor, descricao: `o parceiro ${d.codparceiro ?? 0}` }],
        dataSetC: [{ codplanocontas: d.conta_cc == null ? null : Number(d.conta_cc), valor, descricao: `o centro de custo ${d.cc_desc ?? d.codplc}` }],
        desclote: `Conta a receber ${codrcb}`,
      });
      await trx.updateTable('areceber').set({ contabilizado: 'S' }).where('codrcb', '=', codrcb).execute();
      lancamentos += 1;
      total = r2(total + valor);
    }
    return { documentos: docs.length, lancamentos, total };
  }

  /**
   * TRANSFERÊNCIA ENTRE CONTAS — origem 19 (`:4283-4400`), a terceira maior do razão (17.581 linhas, todas
   * balanceadas). A transferência é reconhecida por `NRODOCUMENTO LIKE '%TRANSFERENCIA%'` (37.572 linhas no
   * cliente) e o par vem do LOTE: a movimentação de crédito é a conta que RECEBEU (débito contábil) e a de
   * débito do mesmo lote é a que ENVIOU (crédito contábil). As duas contas saem do `CODLANCCONTABIL`.
   */
  private async transferencias(trx: AnyDB, emp: number, p: { dataIni: string; dataFim: string; codigo?: number | null }, cfg: Record<string, number | null>): Promise<ResultadoDocumentos> {
    const situacao = cfg.config_transferencia_bancaria;
    if (!situacao) throw new BusinessRuleError('SITUACAO_NAO_CONFIGURADA', { qual: 'config_transferencia_bancaria' });
    const docs = (await sql<Record<string, unknown>>`
      SELECT m.codmovconta, m.idlote, to_char(m.dtemissao, 'YYYY-MM-DD') AS data, abs(m.valor) AS valor,
             cbd.codlanccontabil AS conta_deb, cbd.codconta AS codconta_deb,
             (SELECT cbc.codlanccontabil FROM mov_contas_bancarias mc
                JOIN contas_bancarias cbc ON cbc.codconta = mc.codconta
               WHERE mc.idlote = m.idlote AND mc.tipomovimento = 'D' LIMIT 1) AS conta_cred,
             (SELECT mc.codconta FROM mov_contas_bancarias mc
               WHERE mc.idlote = m.idlote AND mc.tipomovimento = 'D' LIMIT 1) AS codconta_cred
        FROM mov_contas_bancarias m
        JOIN contas_bancarias cbd ON cbd.codconta = m.codconta
       WHERE m.tipomovimento = 'C'
         AND abs(m.valor) <> 0
         AND coalesce(m.contabilizado,'N') = 'N'
         AND upper(coalesce(m.nrodocumento,'')) LIKE '%TRANSFERENCIA%'
         AND m.idempresa = ${emp}
         AND ((${p.codigo ?? null}::int IS NOT NULL AND m.idlote = ${p.codigo ?? null}::int)
           OR (${p.codigo ?? null}::int IS NULL AND m.dtemissao BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date))
       ORDER BY m.codmovconta
    `.execute(trx)).rows;

    let lancamentos = 0;
    let total = 0;
    for (const d of docs) {
      const valor = r2(num(d.valor));
      if (!d.data) throw new BusinessRuleError('DOCUMENTO_SEM_DATA', { origem: 'TRANSF', documento: Number(d.codmovconta) });
      await lancarNoDiario(trx, {
        emp, codorigem: ORIGEM.TRANSF, situacao, data: String(d.data), valor,
        idorigem: Number(d.codmovconta), documento: String(d.codmovconta), complemento: String(d.idlote ?? ''),
        dataSetD: [{ codplanocontas: d.conta_deb == null ? null : Number(d.conta_deb), valor, descricao: `a conta ${d.codconta_deb}` }],
        dataSetC: [{ codplanocontas: d.conta_cred == null ? null : Number(d.conta_cred), valor, descricao: `a conta ${d.codconta_cred ?? ''}` }],
        desclote: `Transferência bancária — lote ${d.idlote}`,
      });
      // o legado marca o LOTE inteiro (`:4381`), as duas pontas de uma vez.
      await trx.updateTable('mov_contas_bancarias').set({ contabilizado: 'S' })
        .where('idlote', '=', Number(d.idlote)).where('idempresa', '=', emp).execute();
      lancamentos += 1;
      total = r2(total + valor);
    }
    return { documentos: docs.length, lancamentos, total };
  }

  /**
   * ADIANTAMENTO A PARCEIROS — origem 63 (`:2903-3010`). Um lado é a conta bancária, o outro é o parceiro
   * (`CODCONTABIL`, e só se ele não tiver é que vale o `CODCONTABIL_FOR` — `GetSQLParceiro` :2881). O **TIPO**
   * decide de que lado cada um entra: 'C' põe o parceiro no crédito, qualquer outro no débito.
   */
  private async adiantamentos(trx: AnyDB, emp: number, p: { dataIni: string; dataFim: string; codigo?: number | null }): Promise<ResultadoDocumentos> {
    const docs = (await sql<Record<string, unknown>>`
      SELECT a.codadiantamento, a.valor, to_char(a.dtadiantamento, 'YYYY-MM-DD') AS data, a.codparceiro, a.tipo,
             a.idsituacao_nf, cb.codconta, cb.codlanccontabil AS conta_banco,
             coalesce(pa.codcontabil::int, pa.codcontabil_for::int) AS conta_parceiro
        FROM adiantamento_forn a
        LEFT JOIN parceiros pa ON pa.codparceiro = a.codparceiro
        LEFT JOIN contas_bancarias cb ON cb.codconta = a.codcontacorrente
       WHERE coalesce(a.contabilizado,'N') = 'N'
         AND a.idsituacao_nf IS NOT NULL
         AND a.idempresa = ${emp}
         AND ((${p.codigo ?? null}::int IS NOT NULL AND a.codadiantamento = ${p.codigo ?? null}::int)
           OR (${p.codigo ?? null}::int IS NULL AND a.dtadiantamento BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date))
       ORDER BY a.dtadiantamento, a.codadiantamento
    `.execute(trx)).rows;

    let lancamentos = 0;
    let total = 0;
    for (const d of docs) {
      const cod = Number(d.codadiantamento);
      const valor = r2(num(d.valor));
      const parceiro: RegistroDataSet = { codplanocontas: d.conta_parceiro == null ? null : Number(d.conta_parceiro), valor, descricao: `o parceiro ${d.codparceiro ?? 0}` };
      const banco: RegistroDataSet = { codplanocontas: d.conta_banco == null ? null : Number(d.conta_banco), valor, descricao: `a conta ${d.codconta ?? ''}` };
      const parceiroNoCredito = String(d.tipo ?? '') === 'C';
      await lancarNoDiario(trx, {
        emp, codorigem: ORIGEM.ADTO, situacao: Number(d.idsituacao_nf), data: String(d.data), valor,
        idorigem: cod, documento: String(cod), complemento: String(cod),
        dataSetC: [parceiroNoCredito ? parceiro : banco],
        dataSetD: [parceiroNoCredito ? banco : parceiro],
        desclote: `Adiantamento ${cod}`,
      });
      await trx.updateTable('adiantamento_forn').set({ contabilizado: 'S' }).where('codadiantamento', '=', cod).execute();
      await trx.updateTable('mov_contas_bancarias').set({ contabilizado: 'S' })
        .where('codadiantamento', '=', cod).where('idempresa', '=', emp).execute();
      lancamentos += 1;
      total = r2(total + valor);
    }
    return { documentos: docs.length, lancamentos, total };
  }

  /**
   * MOVIMENTAÇÃO DO CAIXA — origem 64 (`:2637-2760`). Um lado é a conta bancária do movimento, o outro é o
   * **centro de custo** (`CAIXA.CODPLC` → `PLC.CODCONTABIL`). Aqui quem decide o lado é o **sinal do valor**:
   * positivo (entrada) põe o centro de custo no crédito e o banco no débito; negativo inverte. O valor lançado
   * é sempre o absoluto. Só entram movimentos com situação informada (`:2602`).
   */
  private async movimentacaoCaixa(trx: AnyDB, emp: number, p: { dataIni: string; dataFim: string; codigo?: number | null }): Promise<ResultadoDocumentos> {
    const docs = (await sql<Record<string, unknown>>`
      SELECT c.codcx, c.valor, to_char(c.data, 'YYYY-MM-DD') AS data, c.codplc, c.codconta, c.idsituacao_nf, c.idlote,
             pc.codplanocontas AS conta_cc, pl.descricao AS cc_desc, cb.codlanccontabil AS conta_banco
        FROM caixa c
        LEFT JOIN plc pl ON pl.codplc = c.codplc
        LEFT JOIN plano_contas pc ON pc.codplanocontas = pl.codcontabil
        LEFT JOIN contas_bancarias cb ON cb.codconta = c.codconta
       WHERE coalesce(c.contabilizado,'N') = 'N'
         AND c.idsituacao_nf IS NOT NULL
         AND c.idempresa = ${emp}
         AND ((${p.codigo ?? null}::int IS NOT NULL AND c.idlote = ${p.codigo ?? null}::int)
           OR (${p.codigo ?? null}::int IS NULL AND c.data::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date))
       ORDER BY c.data::date, c.codcx
    `.execute(trx)).rows;

    let lancamentos = 0;
    let total = 0;
    for (const d of docs) {
      const codcx = Number(d.codcx);
      const valor = r2(Math.abs(num(d.valor)));
      const centro: RegistroDataSet = { codplanocontas: d.conta_cc == null ? null : Number(d.conta_cc), valor, descricao: `o centro de custo ${d.cc_desc ?? d.codplc}` };
      const banco: RegistroDataSet = { codplanocontas: d.conta_banco == null ? null : Number(d.conta_banco), valor, descricao: `a conta ${d.codconta ?? ''}` };
      const entrada = num(d.valor) > 0;
      await lancarNoDiario(trx, {
        emp, codorigem: ORIGEM.CAIXA, situacao: Number(d.idsituacao_nf), data: String(d.data), valor,
        idorigem: codcx, documento: String(codcx), complemento: String(codcx),
        dataSetC: [entrada ? centro : banco],
        dataSetD: [entrada ? banco : centro],
        desclote: `Movimentação de caixa ${codcx}`,
      });
      await trx.updateTable('caixa').set({ contabilizado: 'S' }).where('codcx', '=', codcx).execute();
      if (d.idlote != null) {
        await trx.updateTable('mov_contas_bancarias').set({ contabilizado: 'S' })
          .where('idlote', '=', Number(d.idlote)).where('idempresa', '=', emp).execute();
      }
      lancamentos += 1;
      total = r2(total + valor);
    }
    return { documentos: docs.length, lancamentos, total };
  }

  /**
   * AGRUPAMENTO DE CONVÊNIO — origem 65 (`:3195-3300`). O convênio junta N recebíveis de funcionários numa
   * conta a pagar para a empresa conveniada; o lançamento é **por GRUPO**: débito fixo (a conta de
   * adiantamento) e um crédito por recebível. É o formato mais desigual do razão — **15.089 linhas só-crédito
   * contra 30 só-débito, em 30 grupos**, porque a situação 910 tem histórico diferente por perna (104/105).
   *
   * O flag é próprio (`CONTABILIZADO_AGRUPAMENTO`), não o `CONTABILIZADO` do título — os dois convivem.
   */
  private async convenio(trx: AnyDB, emp: number, p: { dataIni: string; dataFim: string; codigo?: number | null }, cfg: Record<string, number | null>): Promise<ResultadoDocumentos> {
    const situacao = cfg.config_agrupamento_convenio;
    if (!situacao) throw new BusinessRuleError('SITUACAO_NAO_CONFIGURADA', { qual: 'config_agrupamento_convenio' });
    const grupos = (await sql<Record<string, unknown>>`
      SELECT DISTINCT a.codgrupo_agrupamento_apg AS codgrupo, to_char(a.data_agrupamento, 'YYYY-MM-DD') AS data
        FROM areceber a
        JOIN apagar ap ON ap.codgrupo = a.codgrupo_agrupamento_apg
       WHERE a.codgrupo_agrupamento_apg IS NOT NULL
         AND coalesce(a.contabilizado_agrupamento,'N') = 'N'
         AND a.codempresa = ${emp}
         AND ((${p.codigo ?? null}::int IS NOT NULL AND a.codgrupo_agrupamento_apg = ${p.codigo ?? null}::int)
           OR (${p.codigo ?? null}::int IS NULL AND a.data_agrupamento BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date))
       ORDER BY 1
    `.execute(trx)).rows;

    let lancamentos = 0;
    let total = 0;
    for (const g of grupos) {
      const codgrupo = Number(g.codgrupo);
      const rcb = (await sql<Record<string, unknown>>`
        SELECT a.codrcb, a.valor, p.codparceiro, coalesce(p.codcontabil::int, p.codcontabil_for::int) AS conta
          FROM areceber a JOIN parceiros p ON p.codparceiro = a.codparceiro
         WHERE a.codgrupo_agrupamento_apg = ${codgrupo} AND a.codempresa = ${emp}
         ORDER BY a.codrcb
      `.execute(trx)).rows;
      const apg = (await sql<Record<string, unknown>>`
        SELECT a.codapg, a.valor, p.codparceiro, coalesce(p.codcontabil_for::int, p.codcontabil::int) AS conta
          FROM apagar a JOIN parceiros p ON p.codparceiro = a.codparceiro
         WHERE a.codgrupo = ${codgrupo} AND a.codempresa = ${emp}
         ORDER BY a.codapg
      `.execute(trx)).rows;
      if (!rcb.length || !apg.length) throw new BusinessRuleError('CONVENIO_GRUPO_SEM_REGISTROS', { codgrupo });

      const valor = r2(rcb.reduce((s, r) => s + num(r.valor), 0));
      await lancarNoDiario(trx, {
        emp, codorigem: ORIGEM.CONVENIO, situacao, data: String(g.data), valor,
        idorigem: Number(rcb[0].codrcb), documento: String(rcb[0].codrcb), complemento: String(codgrupo),
        dataSetC: rcb.map((r) => ({ codplanocontas: r.conta == null ? null : Number(r.conta), valor: r2(num(r.valor)),
          idorigem: Number(r.codrcb), documento: String(r.codrcb), complemento: String(codgrupo), descricao: `o parceiro ${r.codparceiro}` })),
        dataSetD: apg.map((a) => ({ codplanocontas: a.conta == null ? null : Number(a.conta), valor: r2(num(a.valor)),
          idorigem: Number(a.codapg), documento: String(a.codapg), complemento: String(codgrupo), descricao: `o parceiro ${a.codparceiro}` })),
        desclote: `Agrupamento de convênio — grupo ${codgrupo}`,
      });
      await trx.updateTable('areceber').set({ contabilizado_agrupamento: 'S' })
        .where('codgrupo_agrupamento_apg', '=', codgrupo).where('codempresa', '=', emp).execute();
      await trx.updateTable('apagar').set({ contabilizado_agrupamento: 'S' })
        .where('codgrupo', '=', codgrupo).where('codempresa', '=', emp).execute();
      lancamentos += 1;
      total = r2(total + valor);
    }
    return { documentos: grupos.length, lancamentos, total };
  }

  /**
   * ESTORNO. Como nas outras origens do TRON, pela tela é por PERÍODO: apaga o razão daquela origem no
   * intervalo e devolve o flag do documento. Cada origem tem a sua tabela e o seu flag.
   */
  async estornar(tipo: TipoDocumento, p: { dataIni: string; dataFim: string; codigo?: number | null }): Promise<{ linhas: number; documentos: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    await this.assertPeriodoAberto(db, p.dataFim);
    const codorigem = ORIGEM[tipo];

    return db.transaction().execute(async (trx: AnyDB) => {
      const ids = (await sql<{ idorigem: number }>`
        SELECT DISTINCT d.idorigem FROM diario d
         WHERE d.codorigem = ${codorigem} AND d.codempresa = ${emp}
           AND d.datalan BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date
      `.execute(trx)).rows.map((r) => Number(r.idorigem));
      const del = await trx.deleteFrom('diario')
        .where('codorigem', '=', codorigem).where('codempresa', '=', emp)
        .where('datalan', '>=', sql`${p.dataIni}::date`).where('datalan', '<=', sql`${p.dataFim}::date`).execute();
      await sql`DELETE FROM lote_contabil l WHERE l.codorigem = ${codorigem} AND l.codempresa = ${emp}
                  AND NOT EXISTS (SELECT 1 FROM diario d WHERE d.codlote = l.codlotecontabil)`.execute(trx);
      if (ids.length) await this.desmarcar(trx, tipo, emp, ids);
      return { linhas: Number(del[0]?.numDeletedRows ?? 0), documentos: ids.length };
    });
  }

  private async desmarcar(trx: AnyDB, tipo: TipoDocumento, emp: number, ids: number[]): Promise<void> {
    switch (tipo) {
      case 'CP': await trx.updateTable('apagar').set({ contabilizado: null }).where('codapg', 'in', ids).where('codempresa', '=', emp).execute(); break;
      case 'CR': await trx.updateTable('areceber').set({ contabilizado: null }).where('codrcb', 'in', ids).where('codempresa', '=', emp).execute(); break;
      case 'ADTO': await trx.updateTable('adiantamento_forn').set({ contabilizado: null }).where('codadiantamento', 'in', ids).where('idempresa', '=', emp).execute(); break;
      case 'CAIXA': await trx.updateTable('caixa').set({ contabilizado: null }).where('codcx', 'in', ids).where('idempresa', '=', emp).execute(); break;
      case 'TRANSF':
        await trx.updateTable('mov_contas_bancarias').set({ contabilizado: null }).where('codmovconta', 'in', ids).where('idempresa', '=', emp).execute();
        break;
      case 'CONVENIO':
        // o estorno do convênio vai pelo GRUPO (o razão guarda o grupo no complemento das duas pernas).
        await sql`UPDATE areceber SET contabilizado_agrupamento = NULL
                   WHERE codempresa = ${emp} AND codrcb = ANY(${ids})`.execute(trx);
        await sql`UPDATE apagar SET contabilizado_agrupamento = NULL
                   WHERE codempresa = ${emp} AND codgrupo IN (
                     SELECT codgrupo_agrupamento_apg FROM areceber WHERE codrcb = ANY(${ids}))`.execute(trx);
        break;
    }
  }
}
