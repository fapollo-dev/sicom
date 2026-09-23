/**
 * O RATEIO CONTÁBIL que a NF preenche sozinha ao gravar — `InserirLancamentosContabil` (udmNF.pas:11027), chamado no
 * `btnGravar` (uNF.pas:5036) e no botão dos lançamentos (uNF.pas:2912); UCadSituacaoNF.md C3. Só com
 * `UTILIZA_INTEGRACAO_CONTABIL='S'` (na produção: global 'N', módulo Retaguarda 'S'), nota com total, finalidade ≠ 2
 * (complementar) e situação que integra (`NAO_REALIZA_INTEGRACAO≠'S'`):
 *  1. o CENTRO DE CUSTO da situação (SITUACAO_NF_PLC das situações da nota e dos itens) — só quando é UM: a linha leva
 *     o total da nota − bonificado − retenções − desconto de acordo ("V"); se já existe, só ganha o valor se estava 0;
 *  2. as RETENÇÕES: cada situação de retenção da configuração da integração (I13-I19) com centro de custo vira uma
 *     linha ADICIONAL com o valor retido (pula a retenção zerada);
 *  3. o DESCONTO DE ACORDO comercial (I20), tipo "D", quando a nota tem desconto de acordo.
 * Produção (NFs de 2026): situação de entrada com 1 centro de custo → 5.545 de 5.545 NFs com rateio, 5.279 com o
 * valor exato; situação que não integra → 2 de 129.
 */
import { sql } from 'kysely';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { configNaTrx } from '../compras/pedido-heranca';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const RETENCOES: Array<{ op: string; cfg: string; total: string }> = [
  { op: 'I13', cfg: 'config_retencao_pis_nf', total: 'total_ret_pis' },
  { op: 'I14', cfg: 'config_retencao_cofins_nf', total: 'total_ret_cofins' },
  { op: 'I15', cfg: 'config_retencao_csll_nf', total: 'total_ret_csll' },
  { op: 'I16', cfg: 'config_retencao_inss_nf', total: 'total_ret_inss' },
  { op: 'I17', cfg: 'config_retencao_ir_nf', total: 'total_ret_ir' },
  { op: 'I18', cfg: 'config_retencao_issqn_nf', total: 'total_ret_issqn' },
  { op: 'I19', cfg: 'config_retencao_funrural_nf', total: 'total_ret_funrural' },
];

/** insere a linha (situação, centro de custo) ou, se já existe, aplica o ajuste do legado (`Locate` → Edit) */
async function gravarLinha(
  trx: AnyDB, codnf: number, sit: number, cc: number,
  nova: { valor: number; tipovalor: 'V' | 'D'; adicional?: 'S' | 'N' },
  existente: (valorAtual: number) => Record<string, unknown>,
): Promise<void> {
  const atual = (await trx.selectFrom('nf_contabil').select(['codcontabilnf', 'valor']).where('codnf', '=', codnf)
    .where('idsituacao_nf', '=', sit).where('codcc', '=', cc).executeTakeFirst()) as { codcontabilnf: number; valor: unknown } | undefined;
  if (!atual) {
    await trx.insertInto('nf_contabil').values({ codnf, idsituacao_nf: sit, codcc: cc, valor: r2(nova.valor), tipovalor: nova.tipovalor, ...(nova.adicional ? { adicional: nova.adicional } : {}) }).execute();
  } else {
    await trx.updateTable('nf_contabil').set(existente(num(atual.valor))).where('codcontabilnf', '=', atual.codcontabilnf).execute();
  }
}

export async function preencherRateioContabil(trx: AnyDB, codnf: number, emp: number | null): Promise<void> {
  if (emp == null) return;
  const nf = (await trx.selectFrom('nf').selectAll().where('codnf', '=', codnf).where('idempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined;
  if (!nf || num(nf.totalnf) === 0 || String(nf.finalidade ?? '') === '2') return;
  const sitNf = num(nf.idsituacao_nf);
  if (sitNf > 0) {
    const s = (await trx.selectFrom('situacao_nf').select('nao_realiza_integracao').where('idsituacao_nf', '=', sitNf).executeTakeFirst()) as { nao_realiza_integracao?: string } | undefined;
    if (String(s?.nao_realiza_integracao ?? '') === 'S') return;
  }
  const integra = await configNaTrx(trx, 'UTILIZA_INTEGRACAO_CONTABIL', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' });
  if (String(integra ?? '').toUpperCase() !== 'S') return;

  const retencoes = RETENCOES.reduce((s, r) => s + num(nf[r.total]), 0);
  const base = num(nf.totalnf) - num(nf.total_bonificado) - retencoes - num(nf.total_desc_acordo);

  // 1. o centro de custo das situações da nota e dos itens — só quando é um
  const sits = (await sql<{ s: number }>`
    SELECT DISTINCT coalesce(p.idsituacao_nf, n.idsituacao_nf) AS s FROM nf n LEFT JOIN nf_prod p ON p.codnf = n.codnf
     WHERE n.codnf = ${codnf} AND coalesce(p.idsituacao_nf, n.idsituacao_nf) IS NOT NULL
    UNION SELECT idsituacao_nf FROM nf WHERE codnf = ${codnf} AND idsituacao_nf IS NOT NULL`.execute(trx)).rows.map((r: { s: unknown }) => num(r.s));
  if (sits.length) {
    const ccs = (await sql<{ idsituacao_nf: number; codplc: number }>`
      SELECT s.idsituacao_nf, s.codplc FROM situacao_nf_plc s
        JOIN plc p ON p.codplc = s.codplc JOIN situacao_nf t ON t.idsituacao_nf = s.idsituacao_nf
       WHERE s.idsituacao_nf IN (${sql.join(sits)})`.execute(trx)).rows;
    if (ccs.length === 1 && num(ccs[0].idsituacao_nf) > 0 && num(ccs[0].codplc) > 0) {
      await gravarLinha(trx, codnf, num(ccs[0].idsituacao_nf), num(ccs[0].codplc), { valor: base, tipovalor: 'V' },
        (v) => ({ tipovalor: 'V', ...(v === 0 ? { valor: r2(base) } : {}) }));
    }
  }

  const cfg = (await trx.selectFrom('config_integracao_contabil').selectAll().limit(1).executeTakeFirst()) as Record<string, unknown> | undefined;
  if (!cfg) return;

  // 2. as retenções configuradas, cada uma na sua situação com centro de custo (ADICIONAL)
  const sitsRet = RETENCOES.map((r) => num(cfg[r.cfg])).filter((v) => v > 0);
  if (sitsRet.length) {
    const linhas = (await sql<{ idsituacao_nf: number; tipo_operacao: string; codplc: number | null }>`
      SELECT s.idsituacao_nf, s.tipo_operacao, p.codplc FROM situacao_nf s LEFT JOIN situacao_nf_plc p ON p.idsituacao_nf = s.idsituacao_nf
       WHERE s.tipo_operacao IN ('I13','I14','I15','I16','I17','I18','I19') AND s.idsituacao_nf IN (${sql.join(sitsRet)})`.execute(trx)).rows;
    for (const l of linhas) {
      const ret = RETENCOES.find((r) => r.op === String(l.tipo_operacao));
      if (!ret || num(l.idsituacao_nf) <= 0 || num(l.codplc) <= 0) continue;
      const valor = num(nf[ret.total]);
      if (valor === 0) continue;
      await gravarLinha(trx, codnf, num(l.idsituacao_nf), num(l.codplc), { valor, tipovalor: 'V', adicional: 'S' }, () => ({ tipovalor: 'V', valor: r2(valor) }));
    }
  }

  // 3. o desconto de acordo comercial (I20), tipo D
  const acordo = num(nf.total_desc_acordo);
  const sitAcordo = num(cfg.config_acordo_comer_desc_nf);
  if (acordo > 0 && sitAcordo > 0) {
    const linhas = (await sql<{ idsituacao_nf: number; codplc: number | null }>`
      SELECT s.idsituacao_nf, p.codplc FROM situacao_nf s LEFT JOIN situacao_nf_plc p ON p.idsituacao_nf = s.idsituacao_nf
       WHERE s.tipo_operacao = 'I20' AND s.idsituacao_nf = ${sitAcordo}`.execute(trx)).rows;
    for (const l of linhas) {
      if (num(l.idsituacao_nf) <= 0 || num(l.codplc) <= 0) continue;
      await gravarLinha(trx, codnf, num(l.idsituacao_nf), num(l.codplc), { valor: acordo, tipovalor: 'D', adicional: 'N' }, () => ({ tipovalor: 'D', valor: r2(acordo) }));
    }
  }
}
