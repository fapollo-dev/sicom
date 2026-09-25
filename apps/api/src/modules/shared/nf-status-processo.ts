/**
 * A ESTEIRA DA NOTA (`NF_STATUS_PROCESSO`, mig 292) — o `RegistrarProcessoNotaFiscal` do legado, que está em FuncoesApollo
 * (fora do fonte) e foi reconstruído do dado de produção (chave 31260922327834000149550010005198081159244720, esteira
 * 451661-451670): na PRIMEIRA marcação de uma chave nascem as dez etapas, todas 'P' (pendente, sem operador, data nem empresa);
 * a etapa marcada vira 'R' com o operador, a hora e a empresa; e a `NFE_NAO_CADASTRADAS.CODNFSTATUSPRO` da chave aponta a
 * última etapa realizada. Quem marca: a distribuição do manifesto (stManifesto), a ciência e a confirmação (stCiencia,
 * stConfirmacaoOp) e as demais telas da entrada. Até a auditoria de esqueletos o Apollo nunca gravava a tabela — só a lia.
 */
import { sql } from 'kysely';

type AnyDB = any;

export const ETAPAS_NF = [
  ['stManifesto', 'Manifesto Destinatário'],
  ['stCiencia', 'Ciência da operação'],
  ['stCruzamentoPedido', 'Cruzamento com pedido de compra'],
  ['stConfirmacaoOp', 'Confirmação da operação'],
  ['stRepasseItens', 'Lançamento de nota fiscal, repasse de itens'],
  ['stColeta', 'Coleta'],
  ['stConferencia', 'Conferência (coleta)'],
  ['stProcessarFaturar', 'Processar, Faturar'],
  ['stGerarFinanceiro', 'Gerar financeiro'],
  ['stDevolucao', 'Devolução'],
] as const;
export type EtapaNf = (typeof ETAPAS_NF)[number][0];

export async function registrarProcessoNf(db: AnyDB, processo: EtapaNf, chave: string, emp: number, op: number | null, status: 'R' | 'A' = 'R'): Promise<number | null> {
  const ch = String(chave ?? '').replace(/\D/g, '');
  if (ch.length !== 44) return null;
  const tem = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM nf_status_processo WHERE chavenfe = ${ch}`.execute(db)).rows[0];
  if (!Number(tem?.n)) {
    for (let i = 0; i < ETAPAS_NF.length; i++) {
      // a pendente do legado não tem empresa; aqui a coluna é NOT NULL (a carga a resolve pela nota) — vai a da marcação
      await sql`INSERT INTO nf_status_processo (idempresa, chavenfe, ordem, processo, processo_desc, status)
                VALUES (${emp}, ${ch}, ${i + 1}, ${ETAPAS_NF[i][0]}, ${ETAPAS_NF[i][1]}, 'P')`.execute(db);
    }
  }
  const r = (await sql<{ id: number }>`
    UPDATE nf_status_processo SET status = ${status}, codoperador = ${op}, dataprocesso = now(), idempresa = ${emp}
     WHERE chavenfe = ${ch} AND processo = ${processo}
     RETURNING codnfstatuspro AS id`.execute(db)).rows[0];
  if (!r) return null;
  await sql`UPDATE nfe_nao_cadastradas SET codnfstatuspro = ${Number(r.id)} WHERE chavenfe = ${ch}`.execute(db);
  return Number(r.id);
}

/**
 * `DesregistrarProcessoNotaFiscal`: a etapa volta a PENDENTE (sem operador nem data) — a reversão do processamento
 * (stProcessarFaturar, uNF.pas:4279/:9164), a exclusão do financeiro (stGerarFinanceiro, uEstoqueNF.pas:1024), o cancelamento da
 * devolução (stDevolucao). A fila passa a apontar a última etapa ainda realizada.
 */
export async function desregistrarProcessoNf(db: AnyDB, processo: EtapaNf, chave: string): Promise<void> {
  const ch = String(chave ?? '').replace(/\D/g, '');
  if (ch.length !== 44) return;
  await sql`UPDATE nf_status_processo SET status = 'P', codoperador = NULL, dataprocesso = NULL WHERE chavenfe = ${ch} AND processo = ${processo}`.execute(db);
  const ult = (await sql<{ id: number | null }>`SELECT max(codnfstatuspro) AS id FROM nf_status_processo WHERE chavenfe = ${ch} AND status = 'R'`.execute(db)).rows[0];
  await sql`UPDATE nfe_nao_cadastradas SET codnfstatuspro = ${ult?.id ?? null} WHERE chavenfe = ${ch}`.execute(db);
}

/** a chave da NF de ENTRADA (a esteira só acompanha a nota que chega) — null quando não é entrada ou não tem chave */
export async function chaveDeEntrada(db: AnyDB, codnf: number): Promise<string | null> {
  const r = (await sql<{ tipo: string | null; chavenfe: string | null }>`SELECT tipo, chavenfe FROM nf WHERE codnf = ${codnf}`.execute(db)).rows[0];
  if (!r || String(r.tipo ?? '') !== 'E') return null;
  const ch = String(r.chavenfe ?? '').replace(/\D/g, '');
  return ch.length === 44 ? ch : null;
}
