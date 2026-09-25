import { Injectable } from '@nestjs/common';
import { chaveDeEntrada, desregistrarProcessoNf, registrarProcessoNf } from '../shared/nf-status-processo';
import { sql } from 'kysely';
import { configNaTrx } from '../compras/pedido-heranca';
import { apagarRateioDoGrupo, novoGrupo, rateioDoFaturamento, rateioUnico, refazerCaixaDoGrupo } from '../cobranca/apagar-caixa';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from './config.service';
import { gravarLogDaLinha, type CampoLog } from '../../shared/log/registro-log';
import { ApagarService } from '../cobranca/apagar.service';
import { AreceberService } from '../cobranca/areceber.service';
import { lancarCaixaDoAreceber } from '../cobranca/areceber-caixa';

/** as colunas de cada tabela na ORDEM DO ORACLE (a LOG "Nota fiscal" é o `SELECT *` do legado), com o nome do Apollo onde difere */
const LOG_FATURAMENTO: readonly CampoLog[] = [
  'codfaturamento', 'data', 'idnf', 'modalidade', 'valor', 'liberado', 'obs', 'codoperador', 'nrofatura', 'totalparcelasfatura', 'tiporef', 'codref',
  'nronf', 'codbco', 'duplicata', 'valor_desconto', 'valor_bonificado', 'codbarrasboleto',
];
const LOG_CX_APAGAR: readonly CampoLog[] = ['codcxapagar', 'codapg', 'codcc', 'valor', 'codgrupo', 'dtultimalteracao', 'tipo', 'idsituacao_nf'];
const LOG_AUX_ACORDO: readonly CampoLog[] = ['id_auxacordo', 'codacordo', 'codaux', 'tabela', 'ativo', 'indr', 'indr_usuario', 'indr_data'];
const LOG_APAGAR: readonly CampoLog[] = [
  'codapg', 'duplicata', 'docnf', 'obs', 'dtcompra', 'codoperador', 'codparceiro', 'quitada', 'logado', ['IDEMPRESA', 'codempresa'], 'idnf', 'gerado', 'valor',
  'txjuros', 'dtvenc', 'tipodoc', 'codbco', 'nrodup', 'nrparcela', 'codgrupo', 'gfat', 'codcentrocusto', 'vendor', 'convenio', 'usultalteracao',
  'dtultimalteracao', 'idlote', 'adfornecedor', 'contabilizado', 'codapg_pai', 'desconto', 'old_codparceiro', 'dtcadastro', 'form',
  'operacao_convenio_funcionario', 'codplcfuncionarios', 'codconvenio', 'codcxagrupamentocr', 'status_pendencia', 'codoperador_aceite_pendencia',
  'data_aceite_pendencia', 'bloqueio', 'idsituacao_nf', 'geradocartaoproprio', 'codapgcartao', 'adcredito', 'origem', 'codgrupo_fcx', 'contabilnf',
  'agrupamento', 'agrupado', 'codgrupo_agrupamento_apg', 'codadiantamento', 'codbarrasblt', 'remessa_gerada', 'contabilizado_agrupamento', 'retencao',
  'codplanocontas_deb_baixa_cp', 'codparceirocedente', 'cod_desconto_titulo', 'codgrupo_desconto_titulo', 'cadastrado_manualmente', 'lote_remessa',
  'retorno_op', 'percjuros', 'mora', 'cod_agenda_prev_pagto', 'baixa_autorizada', 'codoperador_autorizada', 'data_autorizada', 'obs_autorizada',
  'codoperador_auto_paga', 'data_auto_paga', 'obs_auto_paga', 'baixa_auto_paga', 'codoperador_auto_trans', 'data_auto_trans', 'obs_auto_trans',
  'baixa_auto_trans', 'codoperador_autentica_trans', 'data_autentica_trans', 'obs_autentica_trans', 'baixa_autentica_trans', 'chavenfe',
];
const LOG_ARECEBER: readonly CampoLog[] = [
  'codrcb', 'duplicata', 'nrocupom', 'docnf', 'obs', 'dtvenda', 'quitada', 'logado', 'nropedido', 'idnf', 'gerado', 'valor', 'txjuros', 'dtvenc', 'tipodoc',
  'nrodup', 'total', 'codgrupo', 'codcobrador', 'codoperador', 'codparceiro', 'codvendedor', 'codoperadorman', 'codempresa', 'nrodoc', 'parcela', 'codcx',
  'codpdv', 'codbco', 'idpgto', 'antecipado', 'lotecob', 'consiliado', 'datalotcob', 'registro_arq_remessa', 'nome_arq_remessa', 'login_arq_remessa',
  'data_arq_remessa', 'txadm', 'usultalteracao', 'dtultimalteracao', 'baixado', 'idrds', 'codconta', 'datatransf', 'lotetransf', 'idlote', 'dtcadastro',
  'codplc', 'status_boleto', 'adfornecedor', 'contabilizado', 'desconto_boleto', 'desconto_boleto_tipo', 'desconto', 'desconto_tipo', 'old_codparceiro',
  'dtfechamentocx', 'chave', 'cadastrado_manualmente', 'status_pendencia', 'codoperador_aceite_pendencia', 'data_aceite_pendencia', 'sequencia',
  'contabilnf', 'agrupamento', 'agrupado', 'codgrupo_agrupamento_apg', 'codgrupo_agrupamento_rcb', 'idsituacao_nf', 'codadiantamento', 'origem',
  'data_agrupamento', 'contabilizado_agrupamento', 'codplanocontas_cred_baixa_cr', 'cod_desconto_titulo', 'codgrupo_desconto_titulo', 'nfadicmanual',
  'diferenca_pedcomp', 'total_brt', 'codagenda', 'nosso_numero_boleto', 'codcfo', 'remessa', 'importado', 'txmulta', 'valor_perc_multa',
  'codparceiropinheirao', 'carencia', 'idintegracao', 'dtpgto', 'dtagendamento', 'codoperador_liberacao', 'qrcodepix',
];
const LOG_CAIXA: readonly CampoLog[] = [
  'codcx', 'data', 'valor', 'vrtitulo', 'obs', 'operador', 'codplc', 'idlote', 'idempresa', 'tiporecurso', 'codconta', 'codparceiro', 'codnf', 'nrparcela',
  'codgrupo', 'dtvenc', 'gfat', 'gerado', 'codpdv', 'status', 'codfiscalcx', 'usultalteracao', 'dtultimalteracao', 'codrcb', 'dtcadastro', 'contabilizado',
  'old_codparceiro', 'idlotebxcartao', 'codscrap', 'chave', 'idsituacao_nf', 'neutra', 'cadastrado_manualmente', 'codmapadesp', 'codcxapagar',
  'bonificado', 'origem', 'idorigem', 'codhistsangria', 'formapgto',
];

/** o que o operador ajusta no pré-lançamento antes de gravar (a tela de Contas a Pagar / Receber aberta pelo Faturamento) */
export interface AjusteTitulo { codfaturamento: number; dtvenc?: string; valor?: number; tipodoc?: string; codbarrasblt?: string | null; idpgto?: number }

type AnyDB = any;
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
/** número de config aceitando vírgula/ponto decimal (idem nf-fiscal). */
const numCfg = (s: string | null | undefined): number => {
  if (!s) return 0;
  const n = Number(String(s).replace(',', '.'));
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
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  /**
   * A CONVERSÃO DA PREVISÃO DO MANIFESTO (binário novo; `compras/manifesto-previsao.service.ts`). No faturamento da nota de
   * entrada, a previsão aberta da chave:
   *  - com UMA parcela, é CONVERTIDA no lugar (5.910 das 6.632 previsões): TIPODOC 'BOLETO', IDNF = a nota, VALOR e vencimento do
   *    faturamento (o valor mudou em 406); o rateio 'V' leva o valor novo e **fica** no CC 3721 e na situação 3540, a OBS de
   *    previsão, a DTCOMPRA (= o vencimento original) e a DUPLICATA = o código — como o legado, que nunca reclassifica; a CAIXA
   *    nasce aqui (o Gravar da tela). O faturamento não cria título nem grupo novo.
   *  - com VÁRIAS, o faturamento cria os títulos da nota e as previsões SAEM (rateio e CAIXA junto).
   * ⚠️ divergência consciente: o legado apagava só UMA previsão (a de menor código) e deixava as outras órfãs — 253 títulos,
   * R$ 379.985,33 em aberto em 24/09/2026, 233 já vencidos, e 2 baixas caíram na previsão. Aqui saem todas (e as que sobram numa
   * conversão de uma parcela também).
   */
  private async converterPrevisoesDoManifesto(trx: AnyDB, codnf: number, emp: number, op: number | null, parcelas: Array<{ valor: number; dtvenc: string }>): Promise<boolean> {
    const chave = (await sql<{ chavenfe: string | null }>`SELECT chavenfe FROM nf WHERE codnf = ${codnf}`.execute(trx)).rows[0]?.chavenfe;
    if (!chave) return false;
    const tz = (await configNaTrx(trx, 'FUSO_HORARIO_ACESSO', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) ?? 'America/Sao_Paulo';
    const previsoes = (await sql<Record<string, unknown>>`SELECT codapg, valor, codgrupo, codparceiro, duplicata, to_char(dtvenc AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS dtvenc_h
        FROM apagar WHERE chavenfe = ${chave} AND codempresa = ${emp} AND tipodoc = 'PREVISÃO' AND idnf IS NULL AND coalesce(quitada, 'N') = 'N'
        ORDER BY codapg FOR UPDATE`.execute(trx)).rows;
    if (!previsoes.length) return false;
    const historico = (codapg: unknown, texto: string) => sql`INSERT INTO historico (coddoc, tabela, historico, data, codoperador, codempresa)
        VALUES (${String(num(codapg))}, 'APAGAR', ${texto.slice(0, 600)}, current_date, ${op}, ${emp})`.execute(trx);
    const tirar = async (p: Record<string, unknown>) => {
      await sql`DELETE FROM caixa WHERE codgrupo = ${p.codgrupo} AND codcxapagar IN (SELECT codcxapagar FROM cx_apagar WHERE codgrupo = ${p.codgrupo})`.execute(trx);
      await sql`DELETE FROM cx_apagar WHERE codgrupo = ${p.codgrupo}`.execute(trx);
      await sql`DELETE FROM apagar WHERE codapg = ${p.codapg}`.execute(trx);
      const razao = (await sql<{ razao: string | null }>`SELECT razao FROM parceiros WHERE codparceiro = ${num(p.codparceiro)}`.execute(trx)).rows[0]?.razao ?? '';
      const milhar = String(Math.round(num(p.valor))).padStart(3, '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      await historico(p.codapg, `EXCLUSAO DO REGISTRO FORNECEDOR: ${num(p.codparceiro)}-${razao}, DOCUMENTO: ${p.duplicata ?? ''}, VALOR: ${milhar}`);
    };
    if (parcelas.length !== 1) {
      for (const p of previsoes) await tirar(p);
      return false;
    }
    const [p0, ...resto] = previsoes;
    const parc = parcelas[0];
    const valor = Math.round(num(parc.valor) * 100) / 100;
    await sql`UPDATE apagar SET tipodoc = 'BOLETO', idnf = ${codnf}, valor = ${valor}, dtvenc = ((${parc.dtvenc}::date)::timestamp AT TIME ZONE ${tz}),
                percjuros = 0, mora = 0, codplcfuncionarios = 0, usultalteracao = ${op}, dtultimalteracao = now()
              WHERE codapg = ${p0.codapg}`.execute(trx);
    await sql`UPDATE cx_apagar SET valor = ${valor}, dtultimalteracao = now() WHERE codgrupo = ${p0.codgrupo} AND coalesce(tipo, 'V') = 'V'`.execute(trx);
    const n = (v: unknown) => String(Number(v)).replace('.', ',');
    const novoVenc = `${parc.dtvenc.slice(8, 10)}/${parc.dtvenc.slice(5, 7)}/${parc.dtvenc.slice(0, 4)}`;
    await historico(p0.codapg, 'ALTERACAO DO CAMPO TIPODOC DE: PREVISÃO PARA: BOLETO');
    await historico(p0.codapg, `ALTERACAO DO CAMPO IDNF DE: 0 PARA: ${codnf}`);
    if (num(p0.valor) !== valor) await historico(p0.codapg, `ALTERACAO DO CAMPO VALOR DE: ${n(p0.valor)} PARA: ${n(valor)}`);
    if (String(p0.dtvenc_h ?? '') !== novoVenc) await historico(p0.codapg, `ALTERACAO DO CAMPO DTVENC DE: ${p0.dtvenc_h ?? ''} PARA: ${novoVenc}`);
    await refazerCaixaDoGrupo(trx, num(p0.codgrupo), op);
    for (const p of resto) await tirar(p);
    return true;
  }

  /**
   * o GRUPO do faturamento no A Pagar (CAIXA-escritores.md §2): o título do fornecedor nasce com CODGRUPO, a OBS do legado
   * (" REFERENTE A NOTA FISCAL <nº> EMITIDA EM dd/mm/aaaa", `SetObs`) e a parcela "i/N"; depois, o rateio pelo
   * CODCONTABILNF e a CAIXA do grupo, como o Gravar da tela de Contas a Pagar por onde o faturamento do legado passa.
   */
  private async obsDaNota(trx: AnyDB, nf: { codnf: number; nronf?: unknown; dtemissao?: unknown }): Promise<string> {
    const emissao = (await sql<{ d: string | null }>`SELECT to_char(${nf.dtemissao}::date, 'DD/MM/YYYY') AS d`.execute(trx)).rows[0]?.d ?? '';
    return ` REFERENTE A NOTA FISCAL ${nf.nronf ?? nf.codnf} EMITIDA EM ${emissao}\r\n`;
  }

  private async fecharGrupoDoFaturamento(trx: AnyDB, codnf: number, codgrupo: number, op: number | null, acordo = 0): Promise<void> {
    const primeiro = (await sql<{ c: string | null }>`SELECT min(codapg) AS c FROM apagar WHERE codgrupo = ${codgrupo}`.execute(trx)).rows[0]?.c;
    if (primeiro == null) return;
    await rateioDoFaturamento(trx, codnf, codgrupo, Number(primeiro), acordo);
    await refazerCaixaDoGrupo(trx, codgrupo, op);
  }

  /** estornar o faturamento apaga o rateio (e a CAIXA) dos grupos dos títulos da NF — a reversão do financeiro do legado */
  private async apagarRateiosDaNf(trx: AnyDB, codnf: number, emp: number): Promise<void> {
    const grupos = (await sql<{ codgrupo: number }>`SELECT DISTINCT codgrupo FROM apagar WHERE idnf = ${codnf} AND codempresa = ${emp} AND codgrupo IS NOT NULL`.execute(trx)).rows;
    for (const g of grupos) await apagarRateioDoGrupo(trx, Number(g.codgrupo));
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
    // ALIQUOTA 0,00% pois o ST vem por MVA, não por alíquota fixa.
    const obs = this.obsRetencao('ICMSST', nronf, totalnf, 0);
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
        codgrupo: await novoGrupo(trx),
      })
      .returning(['codapg', 'codgrupo'])
      .executeTakeFirstOrThrow()
      .then(async (t: { codapg: number; codgrupo: number }) => {
        // o rateio da retenção vai no CC CENTROCUSTO_RET_ICMSST (173/173 em 2026); a CAIXA só nasce se for gravado na tela
        const cc = Number((await configNaTrx(trx, 'CENTROCUSTO_RET_ICMSST', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' })) ?? 0);
        const existe = cc > 0 && (await sql`SELECT 1 FROM plc WHERE codplc = ${cc}`.execute(trx)).rows.length > 0;
        if (existe) await rateioUnico(trx, { codapg: Number(t.codapg), codgrupo: Number(t.codgrupo), codcc: cc, valor: val });
      });
    return 1;
  }

  /** OBS verbatim do legado (udmNF.pas:8514-8516) — FormatFloat('0.00') pt-BR ⇒ VÍRGULA decimal (golden
   * byte-a-byte: '629,18', não '629.18'). Usada pelo RESIDUAL ST (ICMSST, alíq 0) e pela retenção federal. */
  private obsRetencao(imposto: string, nronf: string, totalnf: number, aliquota: number): string {
    return (
      `REF. À RETENÇÕES DE IMPOSTOS. IMPOSTO: ${imposto}\n` +
      `NOTA FISCAL NRO: ${nronf}\n` +
      `VALOR NOTA FISCAL: ${totalnf.toFixed(2).replace('.', ',')}\n` +
      `ALIQUOTA ${imposto}: ${aliquota.toFixed(2).replace('.', ',')}%`
    );
  }

  /** MontarDataVencimento (udmNF.pas:8550) → 'YYYY-MM-DD'. dia>0 → DIA FIXO DO MÊS SEGUINTE (dez→jan/ano+1);
   * dia<=0 → data contábil + 30 dias. (O gate de geração exige dia>0, então na prática é sempre dia-fixo.) */
  private montarDataVencimento(dia: number, dtcontabil: unknown): string {
    const base = new Date(dtcontabil as string | number | Date);
    if (dia <= 0) {
      const d = new Date(base.getTime());
      d.setUTCDate(d.getUTCDate() + 30);
      return d.toISOString().slice(0, 10);
    }
    let y = base.getUTCFullYear();
    let m = base.getUTCMonth() + 1; // mês SEGUINTE (getUTCMonth é 0-11)
    if (m > 11) { m = 0; y += 1; }
    return new Date(Date.UTC(y, m, dia)).toISOString().slice(0, 10);
  }

  /**
   * Corte-4c-b — RETENÇÃO FEDERAL (PIS/COFINS/CSLL/IR/INSS/ISSQN/FUNRURAL) → títulos A Pagar (GerarAPagarDeRetencoes,
   * udmNF.pas:8473). Só ENTRADA. 1 título por imposto com `nf.total_ret_*>0` (computado pelo motor calcularRetencoes,
   * só E03) E órgão-parceiro configurado E dia de vencimento>0. **CODPARCEIRO = ÓRGÃO** (config PARCEIRO_RETENCAO_*;
   * ISSQN = parceiros.codparceiro_ent_issqn do fornecedor) — NÃO o fornecedor. TIPODOC='BOLETO', GERADO='SISTEMA',
   * ORIGEM='N', DTVENDA=DTCONTABIL, DTVENC=MontarDataVencimento, OBS c/ alíquota real. Retorna a SOMA retida
   * (o chamador ABATE o título do fornecedor → líquido, uFinanceiroNotaFiscal.pas:552). Idempotente por (idnf,retencao).
   */
  private async gerarTitulosRetencao(
    trx: AnyDB,
    nf: {
      codnf: number; tipo: string; nronf?: unknown; codparceiro: number; totalnf: unknown; dtcontabil: unknown; idsituacao_nf?: unknown;
      total_ret_pis?: unknown; total_ret_cofins?: unknown; total_ret_csll?: unknown; total_ret_ir?: unknown;
      total_ret_inss?: unknown; total_ret_issqn?: unknown; total_ret_funrural?: unknown;
      perc_aliquota_ret_pis?: unknown; perc_aliquota_ret_cofins?: unknown; perc_aliquota_ret_csll?: unknown; perc_aliquota_ret_ir?: unknown;
      perc_aliquota_ret_inss?: unknown; perc_aliquota_ret_issqn?: unknown; perc_aliquota_ret_funrural?: unknown;
    },
    emp: number,
  ): Promise<number> {
    if (nf.tipo !== 'E') return 0; // retenção só na ENTRADA

    // Gate E03 (SituacaoGeraRetencao, udmNF.pas:8601) re-checado no FATURAMENTO — os total_ret_* são um
    // SNAPSHOT do F2; se a situação foi trocada de E03 p/ outra depois do cálculo, o legado NÃO geraria.
    // Vale p/ PIS/COFINS/CSLL/IR/INSS/ISSQN. FUNRURAL tem gate PRÓPRIO por CFOP (GerarAPagarDeFunRural,
    // udmNF:8931 — procedure separada, não gated em E03), já embutido no snapshot total_ret_funrural.
    const idsit = nf.idsituacao_nf != null ? Number(nf.idsituacao_nf) : 0;
    let ehE03 = false;
    if (idsit) {
      const sit = await trx.selectFrom('situacao_nf').select('tipo_operacao').where('idsituacao_nf', '=', idsit).executeTakeFirst();
      ehE03 = sit?.tipo_operacao === 'E03';
    }

    // alíquota/órgão do ISSQN vêm do FORNECEDOR (parceiros); demais órgãos vêm de config.
    const forn = await trx
      .selectFrom('parceiros')
      .select(['codparceiro_ent_issqn', 'perc_aliquota_ir', 'perc_aliquota_issqn'])
      .where('codparceiro', '=', nf.codparceiro)
      .executeTakeFirst();

    const cfg = (codigo: string) => this.config.resolver(codigo, { empresaId: emp });
    // percSnap = alíquota SNAPSHOT gravada no F2 (nf.perc_aliquota_ret_*, resíduo (e)); preferida na OBS p/ fechar
    // o drift de config entre F2 e F4. 0 (default / NF antiga) → cai no fallback config/parceiro (sem regressão).
    const impostos: Array<{ key: string; valor: number; percSnap: number; parceiroCfg?: string; diaCfg: string; aliqCfg?: string; aliqParceiro?: number; orgaoParceiro?: number }> = [
      { key: 'PIS',      valor: num(nf.total_ret_pis),      percSnap: num(nf.perc_aliquota_ret_pis),      parceiroCfg: 'PARCEIRO_RETENCAO_PISCOFINS_CSLL', diaCfg: 'DIA_VENCIMENTO_RET_PIS',      aliqCfg: 'ALIQUOTA_RETENCAO_PIS' },
      { key: 'COFINS',   valor: num(nf.total_ret_cofins),   percSnap: num(nf.perc_aliquota_ret_cofins),   parceiroCfg: 'PARCEIRO_RETENCAO_PISCOFINS_CSLL', diaCfg: 'DIA_VENCIMENTO_RET_COFINS',   aliqCfg: 'ALIQUOTA_RETENCAO_COFINS' },
      { key: 'CSLL',     valor: num(nf.total_ret_csll),     percSnap: num(nf.perc_aliquota_ret_csll),     parceiroCfg: 'PARCEIRO_RETENCAO_PISCOFINS_CSLL', diaCfg: 'DIA_VENCIMENTO_RET_CSLL',     aliqCfg: 'ALIQUOTA_RETENCAO_CSLL' },
      { key: 'INSS',     valor: num(nf.total_ret_inss),     percSnap: num(nf.perc_aliquota_ret_inss),     parceiroCfg: 'PARCEIRO_RETENCAO_INSS',           diaCfg: 'DIA_VENCIMENTO_RET_INSS',     aliqCfg: 'ALIQUOTA_RETENCAO_INSS' },
      { key: 'IR',       valor: num(nf.total_ret_ir),       percSnap: num(nf.perc_aliquota_ret_ir),       parceiroCfg: 'PARCEIRO_RETENCAO_IR',             diaCfg: 'DIA_VENCIMENTO_RET_IR',       aliqCfg: 'ALIQUOTA_RETENCAO_IR', aliqParceiro: num(forn?.perc_aliquota_ir) },
      { key: 'FUNRURAL', valor: num(nf.total_ret_funrural), percSnap: num(nf.perc_aliquota_ret_funrural), parceiroCfg: 'PARCEIRO_RETENCAO_FUNRURAL',       diaCfg: 'DIA_VENCIMENTO_RET_FUNRURAL', aliqCfg: 'ALIQUOTA_RETENCAO_FUNRURAL' },
      // ISSQN: órgão + alíquota por FORNECEDOR (não config).
      { key: 'ISSQN',    valor: num(nf.total_ret_issqn),    percSnap: num(nf.perc_aliquota_ret_issqn),    diaCfg: 'DIA_VENCIMENTO_RET_ISSQN', aliqParceiro: num(forn?.perc_aliquota_issqn), orgaoParceiro: forn?.codparceiro_ent_issqn != null ? Number(forn.codparceiro_ent_issqn) : 0 },
    ];

    const totalnf = num(nf.totalnf);
    const nronf = String(nf.nronf ?? nf.codnf);
    let somaRetida = 0;

    for (const imp of impostos) {
      if (imp.valor <= 0) continue; // motor não calculou (não é E03 / flag do parceiro off)
      if (imp.key !== 'FUNRURAL' && !ehE03) continue; // gate E03 (FUNRURAL é gated por CFOP, não por situação)
      const dia = numCfg(await cfg(imp.diaCfg));
      if (dia <= 0) continue; // gate: sem dia de vencimento configurado → não gera (fiel udmNF:8619)
      // órgão destinatário: ISSQN = do fornecedor; demais = config. Sem órgão → não gera.
      const orgao = imp.orgaoParceiro != null ? imp.orgaoParceiro : numCfg(await cfg(imp.parceiroCfg as string));
      if (!orgao || orgao <= 0) continue;
      // alíquota p/ a OBS: SNAPSHOT do F2 (resíduo (e), fecha drift) tem precedência; fallback IR/ISSQN=% do
      // parceiro, demais=config (NF antiga / snapshot 0 → comportamento anterior, sem regressão).
      const aliq = imp.percSnap > 0
        ? imp.percSnap
        : (imp.aliqParceiro && imp.aliqParceiro > 0 ? imp.aliqParceiro : (imp.aliqCfg ? numCfg(await cfg(imp.aliqCfg)) : 0));
      // idempotência por (idnf, retencao).
      const ja = await trx.selectFrom('apagar').select('codapg').where('idnf', '=', nf.codnf).where('codempresa', '=', emp).where('retencao', '=', imp.key).executeTakeFirst();
      if (ja) { somaRetida += imp.valor; continue; }
      await trx
        .insertInto('apagar')
        .values({
          codparceiro: orgao, // ÓRGÃO (Receita/INSS/prefeitura), NÃO o fornecedor
          codempresa: emp,
          idnf: nf.codnf,
          dtvenda: nf.dtcontabil,
          dtvenc: this.montarDataVencimento(dia, nf.dtcontabil),
          duplicata: nronf.slice(0, 20),
          nrodup: 1,
          valor: imp.valor,
          txjuros: 0,
          tipodoc: 'BOLETO',
          retencao: imp.key,
          origem: 'N',
          gerado: 'SISTEMA',
          obs: this.obsRetencao(imp.key, nronf, totalnf, aliq),
          quitada: 'N',
          consiliado: 'N',
        })
        .execute();
      somaRetida += imp.valor;
    }
    return somaRetida;
  }

  // ───────────────────────── o FATURAMENTO: parcela pendente → título (TfrmFaturamento2) ─────────────────────────

  /**
   * as parcelas escolhidas, com a nota, na ordem da nota e do nº da parcela. Só da empresa da sessão; só PENDENTES
   * (`LIBERADO` 'N' ou nulo — `MarcarDocumento`, uFaturamento2.pas:702, não marca a liberada); e só de nota PROCESSADA
   * (`BuscaDocsAFaturar`, :310, lista `COALESCE(N.PROC,'N')='S'`).
   */
  private async parcelasEscolhidas(db: AnyDB, codfats: number[], emp: number, travar: boolean): Promise<Array<Record<string, any>>> {
    const ids = [...new Set(codfats.map(Number).filter((x) => Number.isInteger(x) && x > 0))];
    if (!ids.length) throw new BusinessRuleError('FATURAMENTO_SEM_PARCELA');
    const linhas = (await sql<Record<string, any>>`
      SELECT f.codfaturamento, f.idnf, f.data, to_char(f.data, 'YYYY-MM-DD') AS vencimento, f.valor, f.liberado, f.modalidade, f.nrofatura,
             f.totalparcelasfatura, f.duplicata, f.codbarrasboleto,
             n.tipo, n.nronf, n.codparceiro, n.dtemissao, to_char(n.dtemissao, 'YYYY-MM-DD') AS emissao, n.totalnf, n.total_bonificado,
             n.total_desc_acordo, n.idsituacao_nf, n.nropedido, n.chavenfe, n.proc, n.cfop, p.razao
        FROM faturamento f
        JOIN nf n ON n.codnf = f.idnf
        LEFT JOIN parceiros p ON p.codparceiro = n.codparceiro
       WHERE f.codfaturamento = ANY(${ids}::int[]) AND n.idempresa = ${emp}
       ORDER BY f.idnf, f.nrofatura, f.codfaturamento
       ${travar ? sql`FOR UPDATE OF f` : sql``}`.execute(db)).rows;
    if (linhas.length !== ids.length) throw new BusinessRuleError('FATURAMENTO_PARCELA_NAO_ENCONTRADA', { pedidas: ids.length, achadas: linhas.length });
    const liberada = linhas.find((l) => l.liberado === 'S');
    if (liberada) throw new BusinessRuleError('FATURAMENTO_PARCELA_JA_FATURADA', { codfaturamento: liberada.codfaturamento });
    const semProc = linhas.find((l) => String(l.proc ?? 'N') !== 'S');
    if (semProc) throw new BusinessRuleError('FATURAMENTO_NOTA_NAO_PROCESSADA', { codnf: semProc.idnf });
    return linhas;
  }

  /**
   * o PRÉ-LANÇAMENTO de cada nota — o que o Faturamento põe na tela de Contas a Pagar (`ProcessarAPagar` → uAPagar.pas:4487-4600) ou
   * de Contas a Receber (`ProcessarAReceber`, uFaturamento2.pas:781-986), um título por parcela, no shape do DADO de produção:
   *  - A PAGAR (10.287 títulos GFAT 2025-26): VALOR = parcela + acordo/n e DESCONTO = acordo/n; DTCOMPRA = emissão; DUPLICATA = NRONF;
   *    NRPARCELA 'n/t'; TIPODOC 'BOLETO'; CODBARRASBLT da parcela; IDSITUACAO_NF = a situação financeira da situação da nota (0 em
   *    todos); CODPLANOCONTAS_DEB_BAIXA_CP da situação; GFAT 'S', FORM 'TfrmAPagar', operador; GERADO e NRODUP NULOS (o fonte manda
   *    'SISTEMA' e RecordCount, mas o dado tem nulo em 10.287 de 10.287 — o dado decide).
   *  - A RECEBER (112 títulos): DTVENDA = emissão; DUPLICATA = a da parcela ou '<NRONF> - 001/003'; NRODUP = nº de parcelas; TOTAL =
   *    TOTALNF − bonificado; TIPODOC 'BOLETO'; IDPGTO pela FORMAS_PGTO de MODALIDADE = a da parcela (senão o operador escolhe — na
   *    produção não há forma 'A RECEBER', e ele escolhe); CODPLC do CODCONTABILNF não adicional; NROPEDIDO/CODVENDEDOR do pedido.
   */
  private async preLancamento(db: AnyDB, linhas: Array<Record<string, any>>, emp: number): Promise<Array<{ nf: Record<string, any>; tabela: 'apagar' | 'areceber'; titulos: Array<Record<string, any>> }>> {
    const porNf = new Map<number, Array<Record<string, any>>>();
    for (const l of linhas) porNf.set(Number(l.idnf), [...(porNf.get(Number(l.idnf)) ?? []), l]);
    const out: Array<{ nf: Record<string, any>; tabela: 'apagar' | 'areceber'; titulos: Array<Record<string, any>> }> = [];
    for (const [codnf, parc] of porNf) {
      const nf = parc[0];
      const sit = nf.idsituacao_nf != null
        ? ((await sql<{ fin: number | null; cp: number | null; }>`SELECT idsituacao_nf_financeiro AS fin, codplanocontas_deb_baixa_cp AS cp FROM situacao_nf WHERE idsituacao_nf = ${nf.idsituacao_nf}`.execute(db)).rows[0])
        : undefined;
      const idsituacao = Number(sit?.fin ?? 0) || 0;
      const n = parc.length;
      if (nf.tipo === 'E') {
        const acordo = num(nf.total_desc_acordo);
        const obs = await this.obsDaNota(db, { codnf, nronf: nf.nronf, dtemissao: nf.dtemissao });
        out.push({
          nf, tabela: 'apagar',
          titulos: parc.map((p) => ({
            codfaturamento: Number(p.codfaturamento),
            valor: Math.round((num(p.valor) + acordo / n) * 100) / 100,
            desconto: acordo > 0 ? Math.round((acordo / n) * 100) / 100 : 0,
            dtvenc: p.vencimento,
            dtcompra: nf.emissao,
            duplicata: nf.nronf != null ? String(nf.nronf).slice(0, 20) : null,
            nrparcela: `${p.nrofatura ?? 1}/${p.totalparcelasfatura ?? n}`,
            tipodoc: 'BOLETO',
            codbarrasblt: p.codbarrasboleto ?? null,
            idsituacao_nf: idsituacao,
            codplanocontas_deb_baixa_cp: Number(sit?.cp ?? 0) > 0 ? Number(sit?.cp) : null,
            obs,
          })),
        });
      } else {
        const forma = async (modalidade: unknown) => modalidade
          ? ((await sql<{ idpgto: number }>`SELECT idpgto FROM formas_pgto WHERE modalidade = ${String(modalidade)} AND idempresa = ${emp} ORDER BY idpgto LIMIT 1`.execute(db)).rows[0]?.idpgto ?? null)
          : null;
        const plc = (await sql<{ codcc: number }>`SELECT codcc FROM nf_contabil WHERE codnf = ${codnf} AND coalesce(adicional, 'N') = 'N' AND codcc IS NOT NULL ORDER BY codcontabilnf LIMIT 1`.execute(db)).rows[0]?.codcc ?? null;
        const pedidos = (await sql<{ tipo: string | null; nropedido: string | null; nrocupom: unknown; codvendedor: number | null }>`
            SELECT pn.tipo, d.nropedido, v.nrocupom, d.codvendedor
              FROM pedido_nf pn LEFT JOIN pedidos d ON d.codpedidos = pn.codpedido LEFT JOIN vendas v ON v.codvendas = pn.codpedido
             WHERE pn.codnf = ${codnf} AND coalesce(pn.indr, 'I') <> 'E'
             ORDER BY pn.codpedido`.execute(db)).rows;
        // "REFERENTE AO(S) PEDIDO(S): 1, 2" / "REFERENTE AO(S) CUPOM(NS): …" — o tipo do ÚLTIMO decide o rótulo, como no legado (:815-826)
        const refs = pedidos.map((x) => (x.tipo === 'V' ? String(x.nrocupom ?? '') : String(x.nropedido ?? ''))).filter((x) => x !== '');
        const obsPed = refs.length ? `${pedidos[pedidos.length - 1].tipo === 'V' ? 'REFERENTE AO(S) CUPOM(NS): ' : 'REFERENTE AO(S) PEDIDO(S): '}${[...new Set(refs)].join(', ')}` : null;
        const nroped = nf.nropedido ? String(nf.nropedido) : (pedidos.find((x) => x.nropedido)?.nropedido ?? null);
        const vendedor = Number(pedidos[0]?.codvendedor ?? 0) || 0;
        const total = Math.round((num(nf.totalnf) - num(nf.total_bonificado)) * 100) / 100;
        const tits: Array<Record<string, any>> = [];
        for (let i = 0; i < parc.length; i++) {
          const p = parc[i];
          const pad = (x: number) => String(x).padStart(3, '0');
          tits.push({
            codfaturamento: Number(p.codfaturamento),
            valor: num(p.valor),
            dtvenc: p.vencimento,
            dtvenda: nf.emissao,
            docnf: nf.nronf != null && /^\d+$/.test(String(nf.nronf)) ? Number(nf.nronf) : null,
            duplicata: (p.duplicata ? String(p.duplicata) : `${nf.nronf ? `${nf.nronf} - ` : ''}${pad(i + 1)}/${pad(n)}`).slice(0, 20),
            nrodup: n,
            total,
            tipodoc: 'BOLETO',
            idpgto: await forma(p.modalidade),
            codplc: plc,
            idsituacao_nf: idsituacao,
            nropedido: nroped,
            codvendedor: vendedor,
            obs: obsPed,
          });
        }
        out.push({ nf, tabela: 'areceber', titulos: tits });
      }
    }
    return out;
  }

  /** a prévia do Processar (F2): o pré-lançamento que a tela mostra para o operador ajustar antes de gravar */
  async previa(codfats: number[]) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const pre = await this.preLancamento(db, await this.parcelasEscolhidas(db, codfats, emp, false), emp);
    return pre.map((x) => ({ codnf: Number(x.nf.idnf), nronf: x.nf.nronf, tipo: x.nf.tipo, titular: x.nf.razao, tabela: x.tabela, titulos: x.titulos }));
  }

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * PROCESSAR (F2) as parcelas escolhidas: um título por parcela, no shape do pré-lançamento com os ajustes do operador (vencimento,
   * valor, tipo de documento, código de barras; na saída também a forma), numa transação. Cada nota vira um grupo; a parcela fica
   * LIBERADO='S' (`UpdateFaturamento`, udmFaturamento.pas:328 — por CODFATURAMENTO, sem LOG) e a esteira marca stGerarFinanceiro.
   */
  async processar(dto: { codfaturamento: number[]; ajustes?: AjusteTitulo[]; confirmarRepetida?: boolean }) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const linhas = await this.parcelasEscolhidas(trx, dto.codfaturamento, emp, true);
      return this.faturarNaTrx(trx, linhas, emp, op, { ajustes: dto.ajustes ?? [], confirmarRepetida: !!dto.confirmarRepetida });
    });
  }

  private async faturarNaTrx(
    trx: AnyDB, linhas: Array<Record<string, any>>, emp: number, op: number | null,
    o: { ajustes: AjusteTitulo[]; confirmarRepetida: boolean; automatico?: boolean },
  ): Promise<{ notas: Array<{ codnf: number; tabela: 'apagar' | 'areceber'; titulos: number[] }> }> {
    const ajuste = new Map(o.ajustes.map((a) => [Number(a.codfaturamento), a]));
    const pre = await this.preLancamento(trx, linhas, emp);
    const notas: Array<{ codnf: number; tabela: 'apagar' | 'areceber'; titulos: number[] }> = [];
    for (const { nf, tabela, titulos } of pre) {
      const codnf = Number(nf.idnf);
      for (const t of titulos) {
        const a = ajuste.get(t.codfaturamento);
        if (!a) continue;
        if (a.dtvenc) t.dtvenc = String(a.dtvenc).slice(0, 10);
        if (a.valor != null) t.valor = Math.round(num(a.valor) * 100) / 100;
        if (a.tipodoc) t.tipodoc = String(a.tipodoc).slice(0, 25);
        if (tabela === 'apagar' && a.codbarrasblt !== undefined) t.codbarrasblt = a.codbarrasblt || null;
        if (tabela === 'areceber' && a.idpgto != null) t.idpgto = Number(a.idpgto);
      }
      if (titulos.some((t) => !(num(t.valor) > 0))) throw new BusinessRuleError('FATURAMENTO_VALOR_INVALIDO', { codnf });
      const ids: number[] = [];
      if (tabela === 'apagar') {
        // `ValidaDocumentoRepetido` (uAPagar.pas): outra conta da mesma nota, fornecedor e data de compra com o mesmo total
        const soma = Math.round(titulos.reduce((s, t) => s + num(t.valor), 0) * 100) / 100;
        if (!o.confirmarRepetida && !o.automatico) {
          const rep = (await sql<{ codapg: number }>`
            SELECT min(a.codapg) AS codapg FROM apagar a
             WHERE a.idnf = ${codnf} AND a.codparceiro = ${nf.codparceiro} AND (a.dtcompra)::date = ${nf.emissao}::date
               AND ((a.codgrupo IS NOT NULL AND a.codgrupo IN (SELECT g.codgrupo FROM apagar g WHERE g.idnf = ${codnf} AND g.codgrupo IS NOT NULL
                                                               GROUP BY g.codgrupo HAVING sum(g.valor) = ${soma}))
                    OR (a.codgrupo IS NULL AND a.valor = ${soma}))`.execute(trx)).rows[0];
          if (rep?.codapg != null) throw new BusinessRuleError('FATURAMENTO_CONTA_REPETIDA', { codnf, codapg: Number(rep.codapg) });
        }
        // a previsão do manifesto da chave: com uma parcela vira o título; com várias, sai
        const convertida = await this.converterPrevisoesDoManifesto(trx, codnf, emp, op, titulos.map((t) => ({ valor: num(t.valor), dtvenc: String(t.dtvenc) })));
        if (convertida) {
          const c = (await sql<{ codapg: number }>`SELECT codapg FROM apagar WHERE idnf = ${codnf} AND tipodoc = 'BOLETO' ORDER BY codapg DESC LIMIT 1`.execute(trx)).rows[0];
          if (c) ids.push(Number(c.codapg));
        } else {
          const codgrupo = await novoGrupo(trx);
          for (const t of titulos) {
            const { codfaturamento: _cf, ...cols } = t;
            const ins = (await trx.insertInto('apagar').values({
              ...cols,
              dtvenda: t.dtcompra, // a data do documento para os leitores do Apollo (o legado só tem DTCOMPRA)
              codparceiro: nf.codparceiro, codempresa: emp, idnf: codnf, codgrupo, codoperador: op, txjuros: 0,
              gfat: 'S', gerado: o.automatico ? 'SISTEMA' : null, nrodup: null, form: 'TfrmAPagar', quitada: 'N', consiliado: 'N',
              vendor: 0, convenio: 'N', operacao_convenio_funcionario: 'D', codplcfuncionarios: 0, agrupamento: 'N', agrupado: 'N', percjuros: 0, mora: 0,
              usultalteracao: op, dtultimalteracao: sql`now()`, dtcadastro: sql`now()`,
            }).returning('codapg').executeTakeFirstOrThrow()) as { codapg: number };
            ids.push(Number(ins.codapg));
          }
          await this.fecharGrupoDoFaturamento(trx, codnf, codgrupo, op, num(nf.total_desc_acordo));
          for (const id of ids) await this.logDoTitulo(trx, 'apagar', id, emp);
        }
      } else {
        const semForma = titulos.find((t) => t.idpgto == null);
        if (semForma) throw new BusinessRuleError('FATURAMENTO_FORMA_OBRIGATORIA', { codnf, codfaturamento: semForma.codfaturamento });
        const login = op == null ? null : ((await trx.selectFrom('operadores').select('login').where('codoperador', '=', op).executeTakeFirst()) as { login?: string } | undefined)?.login ?? null;
        // o juros do título a receber é o padrão da empresa (`cdsReceberNewRecord`, udmCadAReceber.pas:415; nulo na produção → 0)
        const txjuros = num(((await trx.selectFrom('empresas').select('txjuropadrao').where('idempresa', '=', emp).executeTakeFirst()) as { txjuropadrao?: unknown } | undefined)?.txjuropadrao);
        for (const t of titulos) {
          const { codfaturamento: _cf, ...cols } = t;
          const ins = (await trx.insertInto('areceber').values({
            ...cols,
            total_brt: t.total, codparceiro: nf.codparceiro, codempresa: emp, idnf: codnf, codoperador: op, codoperadorman: op, logado: login,
            quitada: 'N', agrupado: 'N', consiliado: 'S', cadastrado_manualmente: 'S', nfadicmanual: 'N', valor_perc_multa: 'F',
            txjuros, txmulta: 0, codgrupo: 0, codbco: 0,
            usultalteracao: op, dtultimalteracao: sql`now()`, dtcadastro: sql`now()`, dtagendamento: sql`now()`,
          }).returning('codrcb').executeTakeFirstOrThrow()) as { codrcb: number };
          ids.push(Number(ins.codrcb));
          await lancarCaixaDoAreceber(trx, Number(ins.codrcb), emp, 'incluir'); // a CAIXA de cada título (111 de 111 na produção)
          await this.logDoTitulo(trx, 'areceber', Number(ins.codrcb), emp);
        }
        // os pedidos da nota viram liquidados (uFaturamento2.pas:960-975)
        await sql`UPDATE pedidos SET processo_liquidado = 'L', dt_fatu = now()
                   WHERE nropedido IN (SELECT d.nropedido FROM pedido_nf pn JOIN pedidos d ON d.codpedidos = pn.codpedido WHERE pn.codnf = ${codnf} AND d.nropedido IS NOT NULL)`.execute(trx);
        await sql`UPDATE cx_pedidos SET faturado = 'S', dt_processamento = now()
                   WHERE nropedido IN (SELECT d.nropedido FROM pedido_nf pn JOIN pedidos d ON d.codpedidos = pn.codpedido WHERE pn.codnf = ${codnf} AND d.nropedido IS NOT NULL)`.execute(trx);
      }
      // a parcela vira LIBERADO='S', uma a uma (sem LOG: 0 "Alterou LIBERADO" em 12.582 na produção); 0 linhas = corrida perdida
      for (const t of titulos) {
        const r = await sql`UPDATE faturamento SET liberado = 'S' WHERE codfaturamento = ${t.codfaturamento} AND coalesce(liberado, 'N') <> 'S'`.execute(trx);
        if (Number(r.numAffectedRows ?? 0) === 0) throw new BusinessRuleError('FATURAMENTO_PARCELA_JA_FATURADA', { codfaturamento: t.codfaturamento });
      }
      // o flag do Apollo (até o corte D o trocar pelos predicados do legado)
      await sql`UPDATE nf SET faturada = 'S', usultalteracao = ${op}, dtultimalteracao = now() WHERE codnf = ${codnf}`.execute(trx);
      const chave = await chaveDeEntrada(trx, codnf);
      if (chave) await registrarProcessoNf(trx, 'stGerarFinanceiro', chave, emp, op);
      notas.push({ codnf, tabela, titulos: ids });
    }
    return { notas };
  }

  /** a LOG do título gravado pela tela de Contas a Pagar / Contas a Receber por onde o Faturamento passa (Inseriu) */
  private async logDoTitulo(trx: AnyDB, tabela: 'apagar' | 'areceber', id: number, emp: number): Promise<void> {
    if (tabela === 'apagar') {
      const depois = (await sql<Record<string, unknown>>`SELECT *, to_char(coalesce(dtcompra::timestamp, dtvenda), 'DD/MM/YYYY') AS dtcompra_log,
          to_char(dtvenc, 'DD/MM/YYYY') AS dtvenc_log FROM apagar WHERE codapg = ${id}`.execute(trx)).rows[0];
      if (depois) await gravarLogDaLinha(trx, { acao: 'Inseriu', formulario: 'Contas a pagar', tabela: 'APAGAR', chave: 'CODAPG', valor: id, idempresa: emp, campos: ApagarService.CAMPOS_LOG, depois });
    } else {
      const depois = (await sql<Record<string, unknown>>`SELECT * FROM areceber WHERE codrcb = ${id}`.execute(trx)).rows[0];
      if (depois) await gravarLogDaLinha(trx, { acao: 'Inseriu', formulario: 'Contas a receber', tabela: 'ARECEBER', chave: 'CODRCB', valor: id, idempresa: emp, campos: AreceberService.CAMPOS_LOG, depois });
    }
  }

  /**
   * BONIFICAR (F4, `btnBonificarClick` → `AtualizarFaturamento('BONIFICADO')`, uFaturamento2.pas:160-206): a parcela fica LIBERADO='S'
   * e MODALIDADE='BONIFICADO' SEM título. O botão só aparece com BONIFICACAO_FATURAMENTO_NF='S' (a produção).
   */
  async bonificar(codfats: number[]): Promise<{ parcelas: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      if (String((await configNaTrx(trx, 'BONIFICACAO_FATURAMENTO_NF', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) ?? 'N').toUpperCase() !== 'S') {
        throw new BusinessRuleError('FATURAMENTO_BONIFICAR_DESLIGADO');
      }
      const linhas = await this.parcelasEscolhidas(trx, codfats, emp, true);
      for (const l of linhas) {
        await sql`UPDATE faturamento SET liberado = 'S', modalidade = 'BONIFICADO' WHERE codfaturamento = ${l.codfaturamento} AND coalesce(liberado, 'N') <> 'S'`.execute(trx);
      }
      return { parcelas: linhas.length };
    });
  }

  /**
   * o botão "Faturamento" da nota (`btnFaturamentoClick`, uNF.pas:4332-4369): a nota própria só depois de enviada ("Envie a nota antes
   * de gerar o faturamento!") e só com parcela pendente ("Não existe faturamento pendente para esta nota fiscal a ser processado.").
   * Devolve o filtro com que o Faturamento abre (emissão, número, A Pagar/A Receber).
   */
  async daNota(codnf: number) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const nf = (await sql<Record<string, any>>`SELECT codnf, tipo, nronf, tipoemissao, statusnfe, to_char(dtemissao, 'YYYY-MM-DD') AS emissao FROM nf WHERE codnf = ${codnf} AND idempresa = ${emp}`.execute(db)).rows[0];
    if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
    if (String(nf.tipoemissao ?? '0') === '0' && !['P', 'D'].includes(String(nf.statusnfe ?? ''))) throw new BusinessRuleError('NF_FATURAMENTO_ENVIE_A_NOTA', { codnf });
    const pend = (await sql<{ codfaturamento: number }>`SELECT codfaturamento FROM faturamento WHERE idnf = ${codnf} AND coalesce(liberado, 'N') = 'N' ORDER BY nrofatura, codfaturamento`.execute(db)).rows;
    if (!pend.length) throw new BusinessRuleError('NF_FATURAMENTO_SEM_PENDENTE', { codnf });
    return { codnf, tipo: nf.tipo, nronf: nf.nronf, dataIni: nf.emissao, dataFim: nf.emissao, pendentes: pend.map((p) => Number(p.codfaturamento)) };
  }

  /**
   * o que o PROCESSAR da nota dispara depois de gravar (`UpdateProdutos`, udmNF.pas:7771-7775): as retenções federais, o RESIDUAL ST e o
   * financeiro automático. Antes o Apollo fazia os dois primeiros dentro do "faturar" — no legado eles não dependem do Faturamento.
   * `GerarFinanceiroAutomaticamente` (udmNF.pas:8112, gate `CFOPGeraFinanceiroAutomatico` = GERA_FINANCEIRO_AUTO e PROC_FINANCEIRO 'S',
   * :9902) fatura sozinho as parcelas pendentes, com GERADO 'SISTEMA' (`GeraApagar`) — nenhum CFOP da produção o liga.
   */
  async aposProcessar(trx: AnyDB, codnf: number, emp: number, op: number | null): Promise<void> {
    const nf = await trx
      .selectFrom('nf')
      .select([
        'codnf', 'tipo', 'nronf', 'cfop', 'codparceiro', 'totalnf', 'dtcontabil', 'icms_st_apagar', 'idsituacao_nf',
        'total_ret_pis', 'total_ret_cofins', 'total_ret_csll', 'total_ret_ir', 'total_ret_inss', 'total_ret_issqn', 'total_ret_funrural',
        'perc_aliquota_ret_pis', 'perc_aliquota_ret_cofins', 'perc_aliquota_ret_csll', 'perc_aliquota_ret_ir', 'perc_aliquota_ret_inss', 'perc_aliquota_ret_issqn', 'perc_aliquota_ret_funrural',
      ])
      .where('codnf', '=', codnf)
      .executeTakeFirst();
    if (!nf) return;
    await this.gerarTitulosRetencao(trx, nf, emp);
    await this.gerarTituloStResidual(trx, nf, emp);
    const cfop = (await sql<{ auto: string | null; fin: string | null }>`SELECT gera_financeiro_auto AS auto, proc_financeiro AS fin FROM cfop WHERE codcfop = ${nf.cfop}`.execute(trx)).rows[0];
    if (cfop?.auto !== 'S' || cfop?.fin !== 'S') return;
    const pend = (await sql<{ codfaturamento: number }>`SELECT codfaturamento FROM faturamento WHERE idnf = ${codnf} AND coalesce(liberado, 'N') <> 'S'`.execute(trx)).rows;
    if (!pend.length) return;
    // a nota acabou de virar PROC='S' nesta transação
    const linhas = await this.parcelasEscolhidas(trx, pend.map((p) => Number(p.codfaturamento)), emp, true);
    if (nf.tipo !== 'E' && (await this.preLancamento(trx, linhas, emp)).some((x) => x.titulos.some((t) => t.idpgto == null))) return; // sem forma resolvida, fica para o operador
    await this.faturarNaTrx(trx, linhas, emp, op, { ajustes: [], confirmarRepetida: true, automatico: true });
  }

  // ───────────────────────── o DESFAZER do legado (corte C) ─────────────────────────

  /** `ExisteFinanceiro` (udmNF.pas:11787): algum título, a pagar ou a receber, com a IDNF */
  async existeFinanceiro(db: AnyDB, codnf: number): Promise<boolean> {
    return (await sql`SELECT 1 FROM apagar WHERE idnf = ${codnf} UNION ALL SELECT 1 FROM areceber WHERE idnf = ${codnf} LIMIT 1`.execute(db)).rows.length > 0;
  }

  /**
   * `VerificaExisteBaixas` (udmNF.pas:11848-11940): baixa ativa (APAGAR_BX/ARECEBER_BX com INDR 'I') ou título quitado, agrupado ou
   * contabilizado, a pagar ou a receber, da nota
   */
  async existeBaixa(db: AnyDB, codnf: number): Promise<boolean> {
    return (await sql`
      SELECT 1 FROM apagar_bx b WHERE coalesce(b.indr, 'I') = 'I' AND b.codapg IN (SELECT codapg FROM apagar WHERE idnf = ${codnf})
      UNION ALL SELECT 1 FROM areceber_bx b WHERE coalesce(b.indr, 'I') = 'I' AND b.codrcb IN (SELECT codrcb FROM areceber WHERE idnf = ${codnf})
      UNION ALL SELECT 1 FROM areceber WHERE idnf = ${codnf} AND (coalesce(agrupado, 'N') = 'S' OR coalesce(quitada, 'N') = 'S' OR coalesce(contabilizado, 'N') = 'S')
      UNION ALL SELECT 1 FROM apagar WHERE idnf = ${codnf} AND (coalesce(agrupado, 'N') = 'S' OR coalesce(quitada, 'N') = 'S' OR coalesce(contabilizado, 'N') = 'S')
      LIMIT 1`.execute(db)).rows.length > 0;
  }

  /** a LOG "Nota fiscal" do `ExcluiFaturamento` (`EnviarParaRegistroDeLog`, udmNF.pas:6401): Excluiu com a linha, CHAVE CODNF, sem normalizar */
  private async logNotaFiscal(trx: AnyDB, tabela: string, codnf: number, linhas: Array<Record<string, unknown>>, campos: readonly CampoLog[], emp: number): Promise<void> {
    for (const antes of linhas) {
      await gravarLogDaLinha(trx, { acao: 'Excluiu', formulario: 'Nota fiscal', tabela, chave: 'CODNF', valor: codnf, idempresa: emp, campos, antes, depois: {}, normalizar: false });
    }
  }

  /**
   * `ExcluiFaturamento` (udmNF.pas:6436-6626): apaga o financeiro da nota — o rateio e a CAIXA dos títulos, o A Receber de acordo
   * comercial (com a AUX_ACORDO_COMERCIAL), os títulos pela IDNF (os do fornecedor, os de retenção e o RESIDUAL ST) e as PARCELAS
   * (FATURAMENTO) —, marca CANCELA_FATURAMENTO='S' e grava a LOG "Nota fiscal" de cada tabela. A esteira desmarca stGerarFinanceiro.
   * ⚠️ divergências conscientes: o legado apaga o rateio/CAIXA só do PRIMEIRO título (na saída sobram as CAIXAs dos outros) e a LOG
   * registra só a primeira linha de cada tabela (o dataset do `GravaLog` fica no 1º registro: 1 LOG por tabela em 100% dos casos de
   * 2025-26); aqui vão todos.
   */
  async excluiFaturamentoNaTrx(trx: AnyDB, codnf: number, tipo: string, emp: number): Promise<void> {
    const entrada = tipo === 'E';
    const tabela = entrada ? 'apagar' : 'areceber';
    const titulos = (await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(tabela)} WHERE idnf = ${codnf} ORDER BY ${sql.ref(entrada ? 'codapg' : 'codrcb')}`.execute(trx)).rows;
    if (entrada) {
      const grupos = [...new Set(titulos.map((t) => t.codgrupo).filter((g) => g != null).map(Number))];
      if (grupos.length) {
        const cx = (await sql<Record<string, unknown>>`SELECT * FROM cx_apagar WHERE codgrupo = ANY(${grupos}::int[]) ORDER BY codcxapagar`.execute(trx)).rows;
        await this.logNotaFiscal(trx, 'CX_APAGAR', codnf, cx, LOG_CX_APAGAR, emp);
        for (const g of grupos) await apagarRateioDoGrupo(trx, g); // o rateio leva a CAIXA (a trigger CAIXA_APAGAR)
      }
      const acordos = (await sql<Record<string, unknown>>`
          SELECT r.*, a.id_auxacordo FROM areceber r JOIN aux_acordo_comercial a ON a.codaux = r.codrcb AND a.tabela = 'ARECEBER'
           WHERE r.idnf = ${codnf} ORDER BY r.codrcb`.execute(trx)).rows;
      if (acordos.length) {
        await this.logNotaFiscal(trx, 'ARECEBER', codnf, acordos, LOG_ARECEBER, emp);
        const aux = (await sql<Record<string, unknown>>`SELECT * FROM aux_acordo_comercial WHERE id_auxacordo = ANY(${acordos.map((x) => Number(x.id_auxacordo))}::numeric[])`.execute(trx)).rows;
        await this.logNotaFiscal(trx, 'AUX_ACORDO_COMERCIAL', codnf, aux, LOG_AUX_ACORDO, emp);
        await sql`DELETE FROM caixa WHERE codrcb = ANY(${acordos.map((x) => Number(x.codrcb))}::int[])`.execute(trx);
        await sql`DELETE FROM areceber WHERE codrcb = ANY(${acordos.map((x) => Number(x.codrcb))}::int[])`.execute(trx);
        await sql`DELETE FROM aux_acordo_comercial WHERE id_auxacordo = ANY(${acordos.map((x) => Number(x.id_auxacordo))}::numeric[])`.execute(trx);
      }
    } else if (titulos.length) {
      const ids = titulos.map((t) => Number(t.codrcb));
      const cx = (await sql<Record<string, unknown>>`SELECT * FROM caixa WHERE codrcb = ANY(${ids}::int[]) ORDER BY codcx`.execute(trx)).rows;
      await this.logNotaFiscal(trx, 'CAIXA', codnf, cx, LOG_CAIXA, emp);
      await sql`DELETE FROM caixa WHERE codrcb = ANY(${ids}::int[])`.execute(trx);
    }
    await this.logNotaFiscal(trx, tabela.toUpperCase(), codnf, titulos, entrada ? LOG_APAGAR : LOG_ARECEBER, emp);
    await sql`DELETE FROM ${sql.table(tabela)} WHERE idnf = ${codnf}`.execute(trx);
    const parcelas = (await sql<Record<string, unknown>>`SELECT * FROM faturamento WHERE idnf = ${codnf} ORDER BY codfaturamento`.execute(trx)).rows;
    await this.logNotaFiscal(trx, 'FATURAMENTO', codnf, parcelas, LOG_FATURAMENTO, emp);
    await sql`DELETE FROM faturamento WHERE idnf = ${codnf}`.execute(trx);
    // "define se o faturamento será liberado para nova inserção ao processar a nota fiscal" (udmNF.pas:6605); o flag do Apollo até o corte D
    await sql`UPDATE nf SET cancela_faturamento = 'S', faturada = 'N' WHERE codnf = ${codnf}`.execute(trx);
    const chave = await chaveDeEntrada(trx, codnf);
    if (chave) await desregistrarProcessoNf(trx, 'stGerarFinanceiro', chave);
  }

  /**
   * `CancelaFaturamento(codnf, tipo, pendência)` (uNF.pas:6668-6733), chamado pela exclusão ('E'), pelo cancelamento ('C'), pela
   * denegação ('N') e pela reversão do processamento ('R'):
   *  - sem título, nada;
   *  - ESTORNA_FINANCEIRO_NF='S': com baixa, avisa e MANTÉM ("Existem documentos financeiros que já foram baixados…"); sem baixa, exclui
   *    (`ExcluiFaturamento`) — com ESTORNA_FINANCEIRO='S' só se o operador confirmar, senão vira pendência;
   *  - ESTORNA_FINANCEIRO_NF≠'S' (a produção): `AdicionaPendenciaFinanceiro` — STATUS_PENDENCIA = o código nos títulos da nota (a pagar
   *    na entrada, a receber na saída); títulos e parcelas FICAM.
   */
  async cancelaFaturamentoNaTrx(
    trx: AnyDB, codnf: number, tipo: string, codigo: 'E' | 'C' | 'N' | 'R', emp: number, op: number | null, confirmado = false,
  ): Promise<'sem-financeiro' | 'excluido' | 'mantido-baixado' | 'pendencia'> {
    if (!(await this.existeFinanceiro(trx, codnf))) return 'sem-financeiro';
    const cfg = async (c: string) => String((await configNaTrx(trx, c, { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) ?? 'N').toUpperCase();
    if ((await cfg('ESTORNA_FINANCEIRO_NF')) === 'S') {
      if (await this.existeBaixa(trx, codnf)) return 'mantido-baixado';
      if ((await cfg('ESTORNA_FINANCEIRO')) !== 'S' || confirmado) {
        await this.excluiFaturamentoNaTrx(trx, codnf, tipo, emp);
        return 'excluido';
      }
    }
    await this.adicionaPendenciaNaTrx(trx, codnf, tipo, codigo);
    return 'pendencia';
  }

  /** `AdicionaPendenciaFinanceiro` (uNF.pas:17885): D devolvida · R revertida · C cancelada · N denegada · E excluída */
  async adicionaPendenciaNaTrx(trx: AnyDB, codnf: number, tipo: string, codigo: string): Promise<void> {
    await sql`UPDATE ${sql.table(tipo === 'E' ? 'apagar' : 'areceber')} SET status_pendencia = ${codigo} WHERE idnf = ${codnf}`.execute(trx);
  }

  /**
   * "Excluir documentos financeiros" da nota (`ExcluirDocumentosFinanceiros`, uNF.pas:17710-17752): só com
   * PERMITE_EXCLUIR_FINANCEIRO_DA_NF='S' (a produção); com baixa, avisa e não exclui; senão `ExcluiFaturamento`.
   */
  async excluirDocumentosFinanceiros(codnf: number): Promise<{ codnf: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      if (String((await configNaTrx(trx, 'PERMITE_EXCLUIR_FINANCEIRO_DA_NF', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) ?? 'N').toUpperCase() !== 'S') {
        throw new BusinessRuleError('NF_EXCLUIR_FINANCEIRO_SEM_PERMISSAO', { codnf });
      }
      const nf = (await trx.selectFrom('nf').select(['codnf', 'tipo']).where('codnf', '=', codnf).where('idempresa', '=', emp).forUpdate().executeTakeFirst()) as { tipo?: string } | undefined;
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      if (await this.existeBaixa(trx, codnf)) throw new BusinessRuleError('NF_FINANCEIRO_BAIXADO', { codnf });
      await this.excluiFaturamentoNaTrx(trx, codnf, String(nf.tipo ?? ''), emp);
    });
    return { codnf };
  }
}
