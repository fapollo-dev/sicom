/**
 * O CAIXA QUE A NF GERA NO PROCESSAMENTO — `GerarLancamentosDeCaixa` (udmNF.pas:9266, chamado no processamento,
 * :7776) e a reversão `ReverteLancamentosDeCaixa` (udmNF.pas:5011, no reverter, uNF.pas:9174); UCadSituacaoNF.md C4.
 * Lançamentos gerenciais na CAIXA (ORIGEM 'NF'), que o fluxo e a DRE de caixa leem. Só finalidade 1 (normal) ou 4
 * (devolução):
 *  - CFOP que GERA FINANCEIRO (`PROC_FINANCEIRO='S'`): só a bonificação — a linha do rateio da situação de bonificação
 *    que vale o total bonificado entra com o valor; a linha da situação da nota (não bonificação) entra com −bonificado;
 *  - CFOP que não gera, SEM rateio: um lançamento com o total da nota no 1º centro de custo da situação;
 *  - CFOP que não gera, COM rateio: um lançamento por linha do rateio.
 * Sinal: saída positiva e entrada negativa; nas bonificações (CFOP x910) o inverso, marcadas BONIFICADO='S'.
 * Produção (2026): 218/218 entradas com rateio → um caixa por linha; 382/382 saídas sem rateio → um caixa com o total;
 * 186/186 saídas com rateio → um por linha. O CANCELAMENTO não apaga (17 NFs canceladas mantêm o caixa), só o reverter.
 */
import { sql } from 'kysely';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const BONIFICACAO = ['1910', '2910', '5910', '6910'];

/** a situação é de bonificação: tem CFOP x910 (`SituacaoDeDocumentoBonificacao`, udmNF.pas:5325) */
async function situacaoBonificacao(trx: AnyDB, sit: number): Promise<boolean> {
  if (!(sit > 0)) return false;
  return !!(await trx.selectFrom('isituacao_nf').select('idisituacao_nf').where('idsituacao_nf', '=', sit)
    .where('codcfop', 'in', BONIFICACAO.map(Number)).executeTakeFirst());
}

const dataBR = (d: unknown): string => {
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s;
};

export async function gerarCaixaDaNf(trx: AnyDB, codnf: number, emp: number, op: number | null): Promise<number> {
  const nf = (await trx.selectFrom('nf').select(['codnf', 'tipo', 'cfop', 'finalidade', 'idsituacao_nf', 'totalnf', 'total_bonificado', 'codparceiro', 'nronf', 'dtemissao'])
    .where('codnf', '=', codnf).where('idempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined;
  if (!nf) return 0;
  const fin = String(nf.finalidade ?? '');
  if (fin !== '1' && fin !== '4') return 0;
  const saida = String(nf.tipo) === 'S';
  const cfop = String(nf.cfop ?? '').trim();
  const sitNf = num(nf.idsituacao_nf);
  const bonificado = num(nf.total_bonificado);

  let gerados = 0;
  const lancar = async (valor: number, codplc: number, bonif: 'S' | 'N') => {
    await trx.insertInto('caixa').values({
      data: nf.dtemissao, valor: r2(valor), vrtitulo: r2(valor), operador: op, idempresa: emp, tiporecurso: 'DINHEIRO',
      codparceiro: nf.codparceiro ?? null, nrparcela: '1/1', codgrupo: sql`nextval('seq_caixa_codgrupo')`,
      dtvenc: sql`current_date`, gerado: 'SISTEMA', codplc, codnf, bonificado: bonif, gfat: 'N',
      obs: ` REFERENTE A NOTA FISCAL ${String(nf.nronf ?? '').trim()} EMITIDA EM ${dataBR(nf.dtemissao)}`, origem: 'NF',
    }).execute();
    gerados++;
  };

  const rateio = (await trx.selectFrom('nf_contabil').select(['idsituacao_nf', 'codcc', 'valor']).where('codnf', '=', codnf)
    .orderBy('codcontabilnf').execute()) as Array<{ idsituacao_nf: unknown; codcc: unknown; valor: unknown }>;
  const geraFinanceiro = String(((await trx.selectFrom('cfop').select('proc_financeiro').where('codcfop', '=', cfop).executeTakeFirst()) as { proc_financeiro?: string } | undefined)?.proc_financeiro ?? '') === 'S';

  if (geraFinanceiro) {
    // o financeiro cobre a nota; o caixa só registra a bonificação
    if (bonificado > 0 && rateio.length) {
      for (const l of rateio) {
        const sit = num(l.idsituacao_nf);
        const bon = await situacaoBonificacao(trx, sit);
        if (Math.abs(bonificado - num(l.valor)) < 0.005 && bon) await lancar(num(l.valor), num(l.codcc), 'S');
        if (sit === sitNf && !bon) await lancar(-bonificado, num(l.codcc), 'S');
      }
    }
    return gerados;
  }

  const bonCfop = BONIFICACAO.includes(cfop);
  // saída positiva, entrada negativa; na bonificação o inverso
  const sinal = (v: number) => (bonCfop ? (saida ? -v : v) : (saida ? v : -v));
  if (!rateio.length) {
    if (sitNf > 0) {
      const cc = (await trx.selectFrom('situacao_nf_plc').select('codplc').where('idsituacao_nf', '=', sitNf).executeTakeFirst()) as { codplc?: unknown } | undefined;
      if (cc) {
        const v = sinal(num(nf.totalnf));
        if (v !== 0) await lancar(v, num(cc.codplc), bonCfop ? 'S' : 'N');
      }
    }
    return gerados;
  }
  for (const l of rateio) {
    const v = sinal(num(l.valor));
    if (v !== 0) await lancar(v, num(l.codcc), bonCfop ? 'S' : 'N');
  }
  return gerados;
}

/** o reverter apaga o caixa da NF (e, com bonificação, todo lançamento BONIFICADO da nota) */
export async function reverterCaixaDaNf(trx: AnyDB, codnf: number, emp: number): Promise<void> {
  const nf = (await trx.selectFrom('nf').select('total_bonificado').where('codnf', '=', codnf).where('idempresa', '=', emp).executeTakeFirst()) as { total_bonificado?: unknown } | undefined;
  if (!nf) return;
  if (num(nf.total_bonificado) > 0) await trx.deleteFrom('caixa').where('codnf', '=', codnf).where('bonificado', '=', 'S').execute();
  await trx.deleteFrom('caixa').where('codnf', '=', codnf).where('origem', '=', 'NF').execute();
}
