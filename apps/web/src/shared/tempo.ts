/**
 * O DIA DE HOJE na loja, 'AAAA-MM-DD'. `new Date().toISOString().slice(0, 10)` dá o dia em UTC: das 21h à meia-noite ele já é
 * amanhã — o filtro abre no dia seguinte e a consulta volta vazia (lição do fuso). Mesmo helper da API (`shared/tempo/hoje.ts`).
 */
export function hojeNaLoja(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}
