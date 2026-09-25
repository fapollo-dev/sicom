import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { configNaTrx } from '../compras/pedido-heranca';
import { gravarLogDaLinha } from '../../shared/log/registro-log';
import { FATURAMENTO_CAMPOS_LOG, formularioDaNf } from './nf.aggregate';
import { SenhaOperacaoService } from './senha-operacao.service';
import { buildParcelas, duplicataDaParcela, modalidadeDaParcela, proximoMes, somarDias, dataDoMes, type TipoCalcParc } from './nf-parcelas';

type AnyDB = any;
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const iso = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const BONIFICACAO = ['1910', '2910'];

export interface ParcelaGerada {
  nrofatura: number;
  totalparcelasfatura: number;
  data: string;
  valor: number;
  liberado: 'N';
  duplicata: string | null;
  modalidade: string;
  nronf: string | null;
}

/**
 * a conferência do PROCESSAR (`btnProcessarClick`, uEstoqueNF.pas:833-845): com o gerar financeiro liberado — o CFOP gera
 * financeiro (`LiberarNotaParaGerarFinanceiro`), a nota ainda não tem título (`not ExisteFinanceiroParaEstaNota`, :1747) e o
 * faturamento não foi travado (`CANCELA_FATURAMENTO<>'N'`, :1939) — Σ parcelas tem de fechar com a base, ao centavo (`FormatFloat
 * ('0.00')` dos dois lados): "O total das faturas é diferente do valor da nota. Confira!". Sem parcela nenhuma a soma é zero e
 * a nota não processa: na produção, das 15.667 entradas processadas em 2025-26, as 859 sem FATURAMENTO são de CFOP sem financeiro
 * (só 2 com PROC_FINANCEIRO='S').
 */
export async function conferirParcelasNoProcessamento(trx: AnyDB, codnf: number, emp: number, op: number | null): Promise<void> {
  const nf = (await trx
    .selectFrom('nf as n')
    .leftJoin('cfop as o', 'o.codcfop', 'n.cfop')
    .select([
      'n.codnf', 'n.cfop', 'n.cancela_faturamento', 'n.totalnf', 'n.total_bonificado', 'n.total_desc_acordo', 'n.total_desc_pedido',
      'n.total_ret_pis', 'n.total_ret_cofins', 'n.total_ret_csll', 'n.total_ret_inss', 'n.total_ret_ir', 'n.total_ret_issqn',
      'n.total_ret_funrural', 'o.proc_financeiro',
    ])
    .where('n.codnf', '=', codnf)
    .executeTakeFirst()) as Record<string, any> | undefined;
  if (!nf) return;
  const liberada = nf.proc_financeiro === 'S'
    || (BONIFICACAO.includes(String(nf.cfop)) && (await configNaTrx(trx, 'FINANCEIRO_BONIFICACAO_ACORDO', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) === 'S');
  if (!liberada || nf.cancela_faturamento === 'N') return;
  const fin = (await sql<{ n: number }>`SELECT (SELECT count(*) FROM apagar WHERE idnf = ${codnf}) + (SELECT count(*) FROM areceber WHERE idnf = ${codnf}) AS n`.execute(trx)).rows[0];
  if (num(fin?.n) > 0) return;
  const soma = num((await sql<{ s: string }>`SELECT coalesce(sum(valor), 0) AS s FROM faturamento WHERE idnf = ${codnf}`.execute(trx)).rows[0]?.s);
  const base = NfParcelasService.base(nf);
  if (base.toFixed(2) !== r2(soma).toFixed(2)) throw new BusinessRuleError('NF_FATURAS_DIFERENTES', { codnf, base, parcelas: r2(soma) });
}

/**
 * As PARCELAS da nota (FATURAMENTO) — a aba de cobrança da NF: `SetConfiguracoesFaturamento` (uNF.pas:16184-16286) monta os
 * padrões e diz se o gerar está liberado; `btnGerarFinClick` (uNF.pas:4389-4487) calcula as parcelas. Nada aqui grava: como
 * no legado, as parcelas vão para a grade da nota e são gravadas com ela (o detalhe `faturamento` do agregado da NF). O título
 * nasce depois, da parcela, no Faturamento.
 */
@Injectable()
export class NfParcelasService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly senhaOp: SenhaOperacaoService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async carregar(db: AnyDB, codnf: number, emp: number) {
    const nf = (await db
      .selectFrom('nf as n')
      .leftJoin('cfop as o', 'o.codcfop', 'n.cfop')
      .select([
        'n.codnf', 'n.tipo', 'n.nronf', 'n.cfop', 'n.codparceiro', 'n.proc', 'n.totalnf', 'n.total_bonificado', 'n.total_desc_acordo',
        'n.total_desc_pedido', 'n.total_ret_pis', 'n.total_ret_cofins', 'n.total_ret_csll', 'n.total_ret_inss', 'n.total_ret_ir',
        'n.total_ret_issqn', 'n.total_ret_funrural', 'n.cod_ped_dev_compra', 'n.cancela_faturamento', 'o.proc_financeiro',
      ])
      .where('n.codnf', '=', codnf)
      .where('n.idempresa', '=', emp)
      .executeTakeFirst()) as Record<string, any> | undefined;
    if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
    return nf;
  }

  /**
   * a base das parcelas (uNF.pas:4479 e :16218): TOTALNF − TOTAL_BONIFICADO − TOTAL_RETENCOES − TOTAL_DESC_ACORDO −
   * TOTAL_DESC_PEDIDO, com TOTAL_RETENCOES = PIS + COFINS + CSLL + INSS + IR + ISSQN + FUNRURAL (cdsNotaCalcFields,
   * udmNF.pas:5574; o SENAR não entra — e é zero em toda a produção). Σ parcelas = esta base em 14.790 de 14.790 NFs de entrada.
   */
  static base(nf: Record<string, unknown>): number {
    const ret = ['total_ret_pis', 'total_ret_cofins', 'total_ret_csll', 'total_ret_inss', 'total_ret_ir', 'total_ret_issqn', 'total_ret_funrural']
      .reduce((s, c) => s + num(nf[c]), 0);
    return r2(num(nf.totalnf) - num(nf.total_bonificado) - ret - num(nf.total_desc_acordo) - num(nf.total_desc_pedido));
  }

  private async temFinanceiro(db: AnyDB, codnf: number): Promise<boolean> {
    const r = (await sql<{ n: number }>`SELECT (SELECT count(*) FROM apagar WHERE idnf = ${codnf}) + (SELECT count(*) FROM areceber WHERE idnf = ${codnf}) AS n`.execute(db)).rows[0];
    return num(r?.n) > 0;
  }

  /** o motivo de o gerar estar desligado (`btnGerarFin.Enabled`, uNF.pas:16207), ou null */
  private async motivoBloqueio(db: AnyDB, nf: Record<string, any>, emp: number, op: number | null): Promise<string | null> {
    // as duas mensagens do legado são a mesma — o parceiro vazio também diz "CFOP" (uNF.pas:16191-16195)
    if (!nf.cfop || !nf.codparceiro) return 'NF_PARCELAS_SEM_CFOP';
    const liberada = nf.proc_financeiro === 'S'
      || (BONIFICACAO.includes(String(nf.cfop)) && (await configNaTrx(db, 'FINANCEIRO_BONIFICACAO_ACORDO', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) === 'S');
    if (!liberada) return 'NF_PARCELAS_CFOP_SEM_FINANCEIRO';
    if (await this.temFinanceiro(db, Number(nf.codnf))) return 'NF_PARCELAS_TEM_FINANCEIRO';
    if (nf.proc === 'S') return 'NF_PARCELAS_NOTA_PROCESSADA';
    return null;
  }

  private async tipoDuplicata(db: AnyDB, emp: number): Promise<{ modelo: number; separador: string }> {
    const e = (await db.selectFrom('empresas').select(['modelo_duplicata', 'separador_duplicata']).where('idempresa', '=', emp).executeTakeFirst()) as
      { modelo_duplicata?: unknown; separador_duplicata?: string | null } | undefined;
    return { modelo: num(e?.modelo_duplicata) || 1, separador: e?.separador_duplicata ?? '' };
  }

  /** os padrões da aba de cobrança (`SetConfiguracoesFaturamento`) e se o gerar está liberado */
  async configuracao(codnf: number) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenantRead() as AnyDB;
    const nf = await this.carregar(db, codnf, emp);
    const motivo = await this.motivoBloqueio(db, nf, emp, op);
    const td = await this.tipoDuplicata(db, emp);
    const parc = nf.codparceiro
      ? ((await db.selectFrom('parceiros').select(['diasprazo', 'venc_prev']).where('codparceiro', '=', nf.codparceiro).executeTakeFirst()) as { diasprazo?: unknown; venc_prev?: unknown } | undefined)
      : undefined;
    const diaVenc = Math.min(num(parc?.venc_prev), 31);
    const intervalo = num(parc?.diasprazo);
    const hoje = hojeSP();
    const [a, m] = hoje.split('-').map(Number);
    // dia fixo: o 1º vencimento é o dia do parceiro no mês corrente (edtDiaVencChange, uNF.pas:10439); intervalo: hoje + N (:16281)
    const tipo: TipoCalcParc = diaVenc > 0 ? 'D' : 'I';
    const vencimento = tipo === 'D' ? dataDoMes(a, m, diaVenc) : somarDias(hoje, intervalo);
    const base = NfParcelasService.base(nf);
    const soma = num((await sql<{ s: string }>`SELECT coalesce(sum(valor), 0) AS s FROM faturamento WHERE idnf = ${codnf}`.execute(db)).rows[0]?.s);
    return {
      codnf,
      habilitado: motivo == null,
      motivo,
      legenda: BONIFICACAO.includes(String(nf.cfop)) ? 'Ge&rar financeiro bonificação' : 'Ge&rar financeiro',
      exigeSenha: BONIFICACAO.includes(String(nf.cfop)),
      modeloDuplicata: td.modelo,
      nroDupHabilitado: td.modelo === 1,
      numParcelas: 1,
      diaVenc,
      intervalo,
      tipoCalc: tipo,
      vencimento,
      base,
      valorAFaturar: r2(base - soma),
    };
  }

  /**
   * `DataPrimeiraParcelaNotaDevolucao` (udmNF.pas:6331-6384): a NF de devolução de compra vence QUANTIDADE_DIAS_GERAR_BOLETO_DEVOLUCAO
   * dias (produção: 15) depois do 1º vencimento da nota devolvida — lido da FATURAMENTO dela —, ou de hoje, quando ele já passou,
   * quando a devolução junta mais de uma nota ou quando não há nota. (Com uma nota sem parcela o legado deixa o resultado sem
   * valor; aqui vale hoje.)
   */
  private async vencimentoDaDevolucao(db: AnyDB, codpeddevcompra: number, emp: number, op: number | null): Promise<string> {
    const dias = Math.trunc(num(await configNaTrx(db, 'QUANTIDADE_DIAS_GERAR_BOLETO_DEVOLUCAO', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })));
    const hoje = hojeSP();
    const nfs = (await sql<{ codnf: number }>`SELECT DISTINCT codnf FROM pedido_devolucao_compra_i WHERE codpeddevcompra = ${codpeddevcompra} AND codnf IS NOT NULL`.execute(db)).rows;
    if (nfs.length !== 1) return somarDias(hoje, dias);
    const pri = (await sql<{ data: unknown }>`SELECT data FROM faturamento WHERE idnf = ${nfs[0].codnf} AND data IS NOT NULL ORDER BY data LIMIT 1`.execute(db)).rows[0];
    const d = iso(pri?.data);
    // `Now() > DATA` compara com a hora: no próprio dia do vencimento já vale hoje
    return somarDias(!d || hoje >= d ? hoje : d, dias);
  }

  /** o `btnGerarFinClick`: calcula as parcelas (não grava — vão para a grade e são gravadas com a nota) */
  async gerar(codnf: number, dto: {
    numParcelas?: number; vencimento?: string; intervalo?: number; diaVenc?: number; tipoCalc?: TipoCalcParc; nroDup?: number | null;
    proximoMes?: boolean; senhaAdmin?: string;
  }): Promise<{ parcelas: ParcelaGerada[]; valorAFaturar: number } | { perguntarProximoMes: true; vencimento: string }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenantRead() as AnyDB;
    const nf = await this.carregar(db, codnf, emp);
    const motivo = await this.motivoBloqueio(db, nf, emp, op);
    if (motivo) throw new BusinessRuleError(motivo, { codnf });
    // 1910/2910 (bonificação): SenhaAdministrativa('ADM') (uNF.pas:4399)
    if (BONIFICACAO.includes(String(nf.cfop))) {
      if (!dto.senhaAdmin) throw new BusinessRuleError('NF_PARCELAS_BONIFICACAO_SENHA', { codnf });
      const { ok } = await this.senhaOp.verificar('admin', dto.senhaAdmin);
      if (!ok) throw new BusinessRuleError('SENHA_ADMINISTRATIVA_INVALIDA', { codnf });
    }
    const n = Math.max(1, Math.trunc(num(dto.numParcelas)) || 1); // edtNumePar <= 0 → 1
    const hoje = hojeSP();
    let venc = iso(dto.vencimento) ?? hoje;
    if (num(nf.cod_ped_dev_compra) > 0) venc = await this.vencimentoDaDevolucao(db, Number(nf.cod_ped_dev_compra), emp, op);
    // "A data de vencimento anterior a data de hoje. Deseja calcular o vencimento da primeira parcela para o próximo mês?"
    if (venc < hoje) {
      if (dto.proximoMes === undefined) return { perguntarProximoMes: true, vencimento: venc };
      if (dto.proximoMes) venc = proximoMes(venc);
    }
    const tipo: TipoCalcParc = dto.tipoCalc === 'D' && num(dto.diaVenc) > 0 ? 'D' : 'I';
    const base = NfParcelasService.base(nf);
    const td = await this.tipoDuplicata(db, emp);
    const nronf = nf.nronf != null ? String(nf.nronf) : null;
    const parcelas = buildParcelas({ valor: base, numParcelas: n, intervalo: num(dto.intervalo), vencimento: venc, diaVenc: num(dto.diaVenc), tipo })
      .map((p, i): ParcelaGerada => ({
        nrofatura: i + 1,
        totalparcelasfatura: n,
        data: p.data,
        valor: p.valor,
        liberado: 'N',
        duplicata: duplicataDaParcela({ modelo: td.modelo, separador: td.separador, nroDup: dto.nroDup ?? null, nronf: nronf ?? '', i, hoje }),
        modalidade: modalidadeDaParcela(String(nf.tipo ?? ''), td.modelo),
        nronf,
      }));
    return { parcelas, valorAFaturar: 0 };
  }

  /**
   * as parcelas do `<cobr><dup>` do XML (a região 'Informações de Faturamento' do `TNFe.ImportaNFe`, NFe.pas:3457-3475): uma por
   * duplicata — DUPLICATA = nDup, DATA = dVenc, VALOR = vDup, NROFATURA/TOTALPARCELASFATURA, NRONF, MODALIDADE pelo tipo da nota e
   * o CODOPERADOR de quem importou; LIBERADO fica nulo (pendente). Sem gate de finalidade nem de CFOP: o legado grava sempre.
   */
  static parcelasDoXml(tipo: string, nronf: string | null, duplicatas: Array<{ nDup: string; dVenc: string; vDup: number }>, op: number | null): Record<string, unknown>[] {
    return duplicatas.map((d, i) => ({
      nronf,
      modalidade: tipo === 'E' ? 'A PAGAR' : 'A RECEBER',
      data: d.dVenc || null,
      valor: d.vDup,
      duplicata: d.nDup || null,
      nrofatura: i + 1,
      totalparcelasfatura: duplicatas.length,
      codoperador: op,
    }));
  }

  /**
   * REGRAVA as parcelas da nota a partir do XML guardado (o "recuperar XML", uNF.pas:6383, que passa pelo mesmo ImportaNFe): só
   * sem título por IDNF — com título as parcelas já foram faturadas. As antigas saem com Excluiu e as novas entram com Inseriu
   * (a LOG da tela: `FATURAMENTO` / `CODNF`, formulário da nota).
   */
  async regravarDoXml(trx: AnyDB, codnf: number, duplicatas: Array<{ nDup: string; dVenc: string; vDup: number }>): Promise<{ parcelas: number; total: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const nf = (await trx.selectFrom('nf').selectAll().where('codnf', '=', codnf).where('idempresa', '=', emp).forUpdate().executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
    if (await this.temFinanceiro(trx, codnf)) throw new BusinessRuleError('NF_JA_FATURADA', { codnf });
    const formulario = formularioDaNf(nf);
    const antigas = (await trx.selectFrom('faturamento').selectAll().where('idnf', '=', codnf).orderBy('codfaturamento').execute()) as Record<string, unknown>[];
    for (const a of antigas) {
      await gravarLogDaLinha(trx, { acao: 'Excluiu', formulario, tabela: 'FATURAMENTO', chave: 'CODNF', valor: codnf, campos: FATURAMENTO_CAMPOS_LOG, antes: a, depois: {} });
    }
    await trx.deleteFrom('faturamento').where('idnf', '=', codnf).execute();
    const novas = NfParcelasService.parcelasDoXml(String(nf.tipo ?? ''), nf.nronf != null ? String(nf.nronf) : null, duplicatas, op);
    for (const p of novas) {
      const linha = (await trx.insertInto('faturamento').values({ ...p, idnf: codnf }).returningAll().executeTakeFirstOrThrow()) as Record<string, unknown>;
      await gravarLogDaLinha(trx, { acao: 'Inseriu', formulario, tabela: 'FATURAMENTO', chave: 'CODNF', valor: codnf, campos: FATURAMENTO_CAMPOS_LOG, depois: linha });
    }
    return { parcelas: novas.length, total: r2(duplicatas.reduce((s, d) => s + num(d.vDup), 0)) };
  }

  /**
   * ATALHO da devolução de compra (a tela de devolução fatura sem passar pela aba de cobrança): a nota sem parcela nenhuma ganha UMA,
   * com a base inteira e o vencimento de `DataPrimeiraParcelaNotaDevolucao` — o que o "Gerar financeiro" daria com 1 parcela. Só com o
   * CFOP que gera financeiro; LOG Inseriu como a grade.
   */
  async parcelaUnicaNaTrx(trx: AnyDB, codnf: number): Promise<number> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const nf = await this.carregar(trx, codnf, emp);
    const ja = num((await sql<{ n: number }>`SELECT count(*)::int AS n FROM faturamento WHERE idnf = ${codnf}`.execute(trx)).rows[0]?.n);
    if (ja > 0) return 0;
    const liberada = nf.proc_financeiro === 'S'
      || (BONIFICACAO.includes(String(nf.cfop)) && (await configNaTrx(trx, 'FINANCEIRO_BONIFICACAO_ACORDO', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) === 'S');
    if (!liberada) throw new BusinessRuleError('NF_PARCELAS_CFOP_SEM_FINANCEIRO', { codnf });
    const venc = num(nf.cod_ped_dev_compra) > 0 ? await this.vencimentoDaDevolucao(trx, Number(nf.cod_ped_dev_compra), emp, op) : hojeSP();
    const td = await this.tipoDuplicata(trx, emp);
    const nronf = nf.nronf != null ? String(nf.nronf) : null;
    const linha = (await trx.insertInto('faturamento').values({
      idnf: codnf, data: venc, valor: NfParcelasService.base(nf), liberado: 'N', nrofatura: 1, totalparcelasfatura: 1, nronf,
      modalidade: modalidadeDaParcela(String(nf.tipo ?? ''), td.modelo),
      duplicata: duplicataDaParcela({ modelo: td.modelo, separador: td.separador, nroDup: null, nronf: nronf ?? '', i: 0, hoje: hojeSP() }),
    }).returningAll().executeTakeFirstOrThrow()) as Record<string, unknown>;
    const cab = (await trx.selectFrom('nf').select(['tipo']).where('codnf', '=', codnf).executeTakeFirst()) as Record<string, unknown>;
    await gravarLogDaLinha(trx, { acao: 'Inseriu', formulario: formularioDaNf(cab), tabela: 'FATURAMENTO', chave: 'CODNF', valor: codnf, campos: FATURAMENTO_CAMPOS_LOG, depois: linha });
    return 1;
  }

  /** "Deseja gerar sequencia de duplicatas?" → `GetID('NRODUP')` (btnGerarSeqFinClick, uNF.pas:2856) */
  async proximaDuplicata(): Promise<{ nroDup: number }> {
    this.emp();
    const r = (await sql<{ n: string }>`SELECT nextval('seq_nrodup') AS n`.execute(this.dbp.forTenant() as AnyDB)).rows[0];
    return { nroDup: Number(r?.n) };
  }
}
