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

export async function registrarProcessoNf(db: AnyDB, processo: EtapaNf, chave: string, emp: number, op: number | null): Promise<number | null> {
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
    UPDATE nf_status_processo SET status = 'R', codoperador = ${op}, dataprocesso = now(), idempresa = ${emp}
     WHERE chavenfe = ${ch} AND processo = ${processo}
     RETURNING codnfstatuspro AS id`.execute(db)).rows[0];
  if (!r) return null;
  await sql`UPDATE nfe_nao_cadastradas SET codnfstatuspro = ${Number(r.id)} WHERE chavenfe = ${ch}`.execute(db);
  return Number(r.id);
}
