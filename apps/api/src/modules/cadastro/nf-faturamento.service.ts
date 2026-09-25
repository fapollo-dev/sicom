import { Injectable } from '@nestjs/common';
import { chaveDeEntrada, desregistrarProcessoNf, registrarProcessoNf } from '../shared/nf-status-processo';
import { sql } from 'kysely';
import { configNaTrx } from '../compras/pedido-heranca';
import { apagarRateioDoGrupo, novoGrupo, rateioDoFaturamento, rateioUnico, refazerCaixaDoGrupo } from '../cobranca/apagar-caixa';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from './config.service';

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
      .select([
        'codnf', 'tipo', 'nronf', 'cancelada', 'faturada', 'contabilizado', 'codparceiro', 'totalnf', 'dtemissao', 'dtcontabil', 'statusnfe', 'icms_st_apagar',
        'idsituacao_nf', 'total_ret_pis', 'total_ret_cofins', 'total_ret_csll', 'total_ret_ir', 'total_ret_inss', 'total_ret_issqn', 'total_ret_funrural',
        'perc_aliquota_ret_pis', 'perc_aliquota_ret_cofins', 'perc_aliquota_ret_csll', 'perc_aliquota_ret_ir', 'perc_aliquota_ret_inss', 'perc_aliquota_ret_issqn', 'perc_aliquota_ret_funrural',
      ])
      .where('codnf', '=', codnf)
      .where('idempresa', '=', emp)
      .forUpdate()
      .executeTakeFirst();
    if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
    if (nf.cancelada === 'S' || nf.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA', { codnf });
    // ⚠️ sem trava de DENEGADA nem de CONTABILIZADA (auditoria g1 #21/#22): o `btnFaturamentoClick` do legado (uNF.pas:4332-4374)
    // libera a denegada e não olha o CONTABILIZADO — e no legado o processar GERA o financeiro e só depois integra o contábil
    // (udmNF.pas:7772-7788); o Apollo contabiliza no processar, então a trava deixava sem faturar 5.409 NFs (2025) e 2.716 (2026).
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
    extraApagar?: { codgrupo: number; obs: string; nrparcela: string; codoperador: number | null },
  ): Promise<void> {
    // o título do faturamento é GFAT='S' e GERADO 'SISTEMA' (uAPagar.pas:2034-2037; 3.430 títulos de NF em 2026) — é por aí que
    // a tela de contas a pagar o reconhece como de origem automática e trava valor, fornecedor e rateio
    const doFaturamento = tabela === 'apagar' ? { gfat: 'S', gerado: 'SISTEMA' } : {};
    await trx.insertInto(tabela).values({ ...row, ...(tabela === 'apagar' && extraApagar ? extraApagar : {}), ...doFaturamento, quitada: 'N', consiliado: 'N' }).execute();
  }

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
  private async grupoDoFaturamento(trx: AnyDB, nf: { codnf: number; nronf?: unknown; dtemissao?: unknown }): Promise<{ codgrupo: number; obs: string }> {
    const codgrupo = await novoGrupo(trx);
    const emissao = (await sql<{ d: string | null }>`SELECT to_char(${nf.dtemissao}::date, 'DD/MM/YYYY') AS d`.execute(trx)).rows[0]?.d ?? '';
    return { codgrupo, obs: ` REFERENTE A NOTA FISCAL ${nf.nronf ?? nf.codnf} EMITIDA EM ${emissao}\r\n` };
  }

  private async fecharGrupoDoFaturamento(trx: AnyDB, codnf: number, codgrupo: number, op: number | null): Promise<void> {
    const primeiro = (await sql<{ c: string | null }>`SELECT min(codapg) AS c FROM apagar WHERE codgrupo = ${codgrupo}`.execute(trx)).rows[0]?.c;
    if (primeiro == null) return;
    await rateioDoFaturamento(trx, codnf, codgrupo, Number(primeiro));
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

  /** flip idempotente nf.faturada 'N'→'S' (CAS) — 0 linhas ⇒ corrida perdida (já faturada). */
  private async marcarFaturada(trx: AnyDB, codnf: number, emp: number, op: number | null): Promise<void> {
    const r = await trx
      .updateTable('nf')
      .set({ faturada: 'S', usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codnf', '=', codnf).where('idempresa', '=', emp).where('faturada', '=', 'N')
      .executeTakeFirst();
    if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('NF_JA_FATURADA', { codnf });
    // a ESTEIRA: gerar o financeiro da nota de entrada marca stGerarFinanceiro (uFinanceiroNotaFiscal.pas:290, udmNF.pas:8462)
    const chave = await chaveDeEntrada(trx, codnf);
    if (chave) await registrarProcessoNf(trx, 'stGerarFinanceiro', chave, emp, op);
  }

  async faturar(
    codnf: number,
    p: { numParcelas: number; primeiroVencimento: string; intervaloDias: number; tipodoc?: string },
  ): Promise<{ codnf: number; tabela: 'areceber' | 'apagar'; parcelas: number }> {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    if (!(p.numParcelas >= 1 && p.numParcelas <= 200)) throw new BusinessRuleError('NUM_PARCELAS_INVALIDO');

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const { nf, tabela, txjuros } = await this.carregarNfFaturavel(trx, codnf, emp);

      // corte-4c-b: gera os títulos de retenção federal (órgão) ANTES e ABATE a base do fornecedor → o
      // fornecedor recebe o LÍQUIDO (bruto − retenções). DIVERGÊNCIA CONSCIENTE: o legado abate TOTAL_RETENCOES
      // = Σ dos 7 total_ret_* COMPUTADOS (uFinanceiroNotaFiscal.pas:552); nós abatemos Σ dos títulos GERADOS
      // (somaRet). Igual no caso normal (todo imposto computado é configurado p/ gerar); diferente só quando um
      // imposto é computado mas não gerado (órgão/dia off) — aí o legado DESBALANCEIA (abate sem gerar título,
      // o valor "some"); nós mantemos Σ(órgão)+Σ(fornecedor)=totalnf. Escolha por livro balanceado.
      const somaRet = await this.gerarTitulosRetencao(trx, nf, emp);
      const totalCents = Math.round((num(nf.totalnf) - somaRet) * 100); // base LÍQUIDA em CENTAVOS
      if (totalCents <= 0) throw new BusinessRuleError('NF_SEM_VALOR', { codnf });

      // rateio: base por parcela + sobra na ÚLTIMA → Σ == totalCents exatamente.
      const baseCents = Math.floor(totalCents / p.numParcelas);
      const resto = totalCents - baseCents * p.numParcelas;
      const venc0 = new Date(`${p.primeiroVencimento}T00:00:00Z`); // UTC (não escorrega 1 dia)
      const dtdoc = nf.tipo === 'E' ? nf.dtemissao : nf.dtcontabil; // APAGAR=emissão / ARECEBER=contábil
      const plano = Array.from({ length: p.numParcelas }, (_, i) => {
        const dt = new Date(venc0);
        dt.setUTCDate(dt.getUTCDate() + i * p.intervaloDias);
        return { valor: (baseCents + (i === p.numParcelas - 1 ? resto : 0)) / 100, dtvenc: dt.toISOString().slice(0, 10) };
      });
      // a previsão do manifesto da chave: com uma parcela ela vira o título; com várias, sai
      const convertida = tabela === 'apagar' && (await this.converterPrevisoesDoManifesto(trx, codnf, emp, op, plano));
      const grupo = tabela === 'apagar' && !convertida ? await this.grupoDoFaturamento(trx, nf) : null;

      for (let i = 0; i < (convertida ? 0 : p.numParcelas); i++) {
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
          ...(p.tipodoc ? { tipodoc: p.tipodoc } : {}), // devolução passa 'BOLETO' (golden); F4 manual mantém NULL
        }, grupo ? { codgrupo: grupo.codgrupo, obs: grupo.obs, nrparcela: `${i + 1}/${p.numParcelas}`, codoperador: op } : undefined);
      }
      if (grupo) await this.fecharGrupoDoFaturamento(trx, codnf, grupo.codgrupo, op);

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
      const plano = duplicatas.map((d) => ({ valor: num(d.vDup), dtvenc: d.dVenc && d.dVenc.trim() ? d.dVenc.slice(0, 10) : String(dtdoc).slice(0, 10) }));
      const convertida = tabela === 'apagar' && (await this.converterPrevisoesDoManifesto(trx, codnf, emp, op, plano));
      if (convertida) totalCents = Math.round(num(duplicatas[0].vDup) * 100);
      const grupo = tabela === 'apagar' && !convertida ? await this.grupoDoFaturamento(trx, nf) : null;

      for (let i = 0; i < (convertida ? 0 : N); i++) {
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
        }, grupo ? { codgrupo: grupo.codgrupo, obs: grupo.obs, nrparcela: `${i + 1}/${N}`, codoperador: op } : undefined);
      }
      if (totalCents <= 0) throw new BusinessRuleError('NF_SEM_VALOR', { codnf });
      if (grupo) await this.fecharGrupoDoFaturamento(trx, codnf, grupo.codgrupo, op);

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

      if (tabela === 'apagar') await this.apagarRateiosDaNf(trx, codnf, emp);
      await trx.deleteFrom(tabela).where('idnf', '=', codnf).where('codempresa', '=', emp).execute();

      const r = await trx
        .updateTable('nf')
        .set({ faturada: 'N', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .where('faturada', '=', 'S')
        .executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('NF_NAO_FATURADA', { codnf });
      // excluir o financeiro desmarca stGerarFinanceiro (uEstoqueNF.pas:1024)
      const chaveEst = await chaveDeEntrada(trx, codnf);
      if (chaveEst) await desregistrarProcessoNf(trx, 'stGerarFinanceiro', chaveEst);
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
    if (tabela === 'apagar') await this.apagarRateiosDaNf(trx, codnf, emp);
    await trx.deleteFrom(tabela).where('idnf', '=', codnf).where('codempresa', '=', emp).execute();
    await trx
      .updateTable('nf')
      .set({ faturada: 'N', usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codnf', '=', codnf)
      .where('idempresa', '=', emp)
      .execute();
    const chaveCanc = await chaveDeEntrada(trx, codnf);
    if (chaveCanc) await desregistrarProcessoNf(trx, 'stGerarFinanceiro', chaveCanc);
    return 'estornado';
  }
}
