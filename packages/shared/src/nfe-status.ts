/**
 * Mapeamento cStat (SEFAZ) → STATUSNFE persistido — regra PURA/PORTÁVEL, espelha o
 * `GetStatusNFE` do legado (NFe.pas:2792-2820). É o tradutor que o provider REAL de SEFAZ
 * usará ao ler a resposta do webservice; o `SimuladorSefazProvider` também o usa (fonte única).
 *
 * Conjuntos verbatim do legado:
 *   100, 539, 204            → 'P' (autorizada/processada)
 *   101, 151, 155, 218       → 'C' (cancelada)
 *   110, 301, 302, 303       → 'D' (denegada)
 *   102, 206, 256            → 'I' (inutilizada — F6b; inutilização de faixa ainda adiada)
 *   demais (rejeições etc.)  → ''  (não autoriza: rascunho/indefinido — o provider trata como erro)
 */
export type StatusNfe = '' | 'P' | 'C' | 'D' | 'I';

const CSTAT_P = new Set([100, 539, 204]);
const CSTAT_C = new Set([101, 151, 155, 218]);
const CSTAT_D = new Set([110, 301, 302, 303]);
const CSTAT_I = new Set([102, 206, 256]);

export function statusFromCstat(cstat: number): StatusNfe {
  if (CSTAT_P.has(cstat)) return 'P';
  if (CSTAT_C.has(cstat)) return 'C';
  if (CSTAT_D.has(cstat)) return 'D';
  if (CSTAT_I.has(cstat)) return 'I';
  return '';
}
