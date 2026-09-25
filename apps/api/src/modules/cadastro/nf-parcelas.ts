/**
 * As PARCELAS da nota (FATURAMENTO) — o `btnGerarFinClick` da NF (uNF.pas:4389-4487), sem o `BuildParcelas`, que está em
 * FuncoesApollo (fora do fonte) e foi reconstruído do dado de produção (FATURAMENTO gerada pela tela, 2024-2026):
 *  - VALOR: `round(base/n, 2)` em cada parcela e a sobra na ÚLTIMA (443,19 em 10 → 9 × 44,32 + 44,31, NF 162943;
 *    3.235,74 em 10 → 9 × 323,57 + 323,61, NF 161411; 370,00 em 3 → 123,33 + 123,33 + 123,34, NF 162379);
 *  - DIA FIXO (`tcDiaFixo`, o dia de vencimento do parceiro): o mesmo dia, mês a mês (28/09, 28/10, … 28/02, NF 162943) — sem
 *    empurrar sábado/domingo (28/11/2026 é sábado e fica). Dia que o mês não tem vira o último dia dele (sem golden: nenhuma
 *    parcela gerada com dia 29-31 atravessou um mês curto; é o que a própria tela faz com o 1º vencimento, uNF.pas:10439);
 *  - INTERVALO (`tcIntervalo`): o 1º vencimento e depois de N em N dias corridos (28/02, 30/03, 29/04 com 30 dias, NF 116598;
 *    7,7 · 15,15 · 30,30 no perfil).
 */

export type TipoCalcParc = 'D' | 'I'; // tcDiaFixo · tcIntervalo

const r2 = (v: number) => Math.round(v * 100) / 100;

/** 'YYYY-MM-DD' de ano/mês(1-12)/dia, com o dia limitado ao último do mês */
export function dataDoMes(ano: number, mes: number, dia: number): string {
  const a = ano + Math.floor((mes - 1) / 12);
  const m = ((mes - 1) % 12 + 12) % 12 + 1;
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const d = Math.min(Math.max(dia, 1), ultimo);
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** soma dias corridos a 'YYYY-MM-DD' */
export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** `IncMonth(data, 1)` — o mesmo dia no mês seguinte, limitado ao último dia dele */
export function proximoMes(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  return dataDoMes(a, m + 1, d);
}

export function buildParcelas(p: {
  valor: number;
  numParcelas: number;
  intervalo: number;
  /** o 1º vencimento ('YYYY-MM-DD') */
  vencimento: string;
  /** com `tipo` 'D', o dia fixo (substitui o dia do 1º vencimento — uNF.pas:4426) */
  diaVenc?: number;
  tipo: TipoCalcParc;
}): Array<{ data: string; valor: number }> {
  const n = Math.max(1, Math.trunc(p.numParcelas) || 1);
  const cent = Math.round(p.valor * 100);
  const parcela = r2(cent / n / 100);
  const out: Array<{ data: string; valor: number }> = [];
  const [ano, mes, diaVenc] = p.vencimento.split('-').map(Number);
  const dia = p.tipo === 'D' && (p.diaVenc ?? 0) > 0 ? Number(p.diaVenc) : diaVenc;
  for (let i = 0; i < n; i++) {
    const data = p.tipo === 'D' ? dataDoMes(ano, mes + i, dia) : somarDias(p.vencimento, i * Math.trunc(p.intervalo || 0));
    const valor = i < n - 1 ? parcela : r2((cent - Math.round(parcela * 100) * (n - 1)) / 100);
    out.push({ data, valor });
  }
  return out;
}

/**
 * a DUPLICATA da parcela (`TipoDuplicata` de EMPRESAS.MODELO_DUPLICATA/SEPARADOR_DUPLICATA, uNF.pas:4449-4462):
 *  - modelo 1 (as 5 empresas da produção): com o nº de duplicata, `<nº><sep><aa><sep><letra A, B, …>`; sem ele, vazia;
 *  - modelo 2: `<NRONF><sep><i+1>`, salvo quando o TIPODOC do vencimento do pedido é CHEQUE (a VENCIMENTOS tem 0 linhas na
 *    produção: nunca é).
 */
export function duplicataDaParcela(p: { modelo: number; separador: string; nroDup?: number | null; nronf: string; i: number; hoje: string; tipodocPedido?: string | null }): string | null {
  if (p.modelo === 2) return p.tipodocPedido === 'CHEQUE' ? null : `${p.nronf}${p.separador}${p.i + 1}`;
  if (p.modelo === 1) return (p.nroDup ?? 0) > 0 ? `${p.nroDup}${p.separador}${p.hoje.slice(2, 4)}${p.separador}${String.fromCharCode(65 + p.i)}` : null;
  return null;
}

/** a MODALIDADE (uNF.pas:4464-4474): entrada 'A PAGAR'; saída 'A RECEBER', ou o TIPODOC do vencimento do pedido no modelo 2 */
export function modalidadeDaParcela(tipo: string, modelo: number, tipodocPedido?: string | null): string {
  if (tipo === 'E') return 'A PAGAR';
  if (modelo === 2) return tipodocPedido ? tipodocPedido : 'A RECEBER';
  return 'A RECEBER';
}
