/** o fuso das lojas (as datas do negócio — vencimento, baixa, período, vigência — são do dia na loja, não do dia em UTC) */
export const FUSO_LOJA = 'America/Sao_Paulo';

/**
 * O DIA DE HOJE na loja, 'AAAA-MM-DD'. `new Date().toISOString().slice(0, 10)` dá o dia em UTC: das 21h à meia-noite ele já é
 * amanhã — a parcela de amanhã "vence hoje", a de hoje "atrasou", a baixa cai no período seguinte (lição do fuso).
 */
export function hojeNaLoja(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_LOJA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}
