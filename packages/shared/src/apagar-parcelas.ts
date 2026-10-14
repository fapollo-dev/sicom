/**
 * O PROCESSAR da tela de Contas a Pagar (`btnGeraParcelasClick` / `GerarDocumentos` + `BuildParcelas`, uAPagar.pas:1256) — o plano
 * das N parcelas de um documento, puro, para a prévia da tela e o gravar da API darem o mesmo resultado:
 *  - vencimentos por INTERVALO de dias a partir do 1º (tcIntervalo) ou no DIA FIXO de cada mês (tcDiaFixo, o IncMonth do Delphi
 *    clampando o fim do mês);
 *  - valor = total/N em centavos, o resíduo na 1ª parcela (ou na última, "Incluir restantes na última parcela");
 *  - desconto e embutidos divididos por N (RoundTo -2), o resíduo na última (:2180);
 *  - DUPLICATA `PREFIXO-001/00N` (BOL-/DUP-/BAN-/CAR-/JUR-/OUT- pelo tipo; `NRONF-` com MODELO_DUPLICATA 2 da empresa) — a digitada
 *    só fica quando é o próprio número da NF (:2164); NRPARCELA `i/N`; OBS `<digitada> PARCELA i DE N` (+ ` REFERENTE A NOTA
 *    FISCAL n EMITIDA EM dd/mm/aaaa` quando há NF — `SetObs`).
 * Produção (14/10/2026): 725 títulos manuais em 37 documentos parcelados em 2026 — `BOL-001/024`, `1/24`, `… PARCELA 1 DE 24`.
 */
export interface PlanoParcelasApagarEntrada {
  total: number;
  nrodup: number;
  /** o vencimento da 1ª parcela (AAAA-MM-DD) */
  venc1: string;
  intervalo?: number | null;
  diaFixo?: number | null;
  restantesNaUltima?: boolean | null;
  desconto?: number | null;
  vendor?: number | null;
  tipodoc?: string | null;
  duplicata?: string | null;
  nronf?: string | number | null;
  /** EMPRESAS.MODELO_DUPLICATA — 2 = `NRONF-` */
  modeloDuplicata?: number | string | null;
  /** a emissão da NF (AAAA-MM-DD), só para a OBS "REFERENTE A NOTA FISCAL" */
  dtcompra?: string | null;
  obs?: string | null;
}
export interface ParcelaApagarPlanejada {
  nrparcela: string;
  duplicata: string;
  dtvenc: string;
  valor: number;
  desconto: number;
  vendor: number;
  obs: string;
}

export class ErroPlanoParcelas extends Error {
  constructor(public readonly code: 'APAGAR_PARCELAS_SEM_CONFIG' | 'APAGAR_PARCELAS_SEM_VENCIMENTO' | 'PARCELA_VALOR_INSUFICIENTE' | 'APAGAR_PARCELAS_NRODUP') {
    super(code);
  }
}

const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
const pad3 = (n: number) => String(n).padStart(3, '0');

/** soma `dias` a uma data ISO (aritmética em UTC — sem deriva de fuso) */
export function somarDiasIso(iso: string, dias: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

/** soma `meses` a uma data ISO fixando o dia (`diaFixo` ?? o dia dela) e clampando ao último dia do mês-alvo (o IncMonth do Delphi) */
export function somarMesesIso(iso: string, meses: number, diaFixo?: number | null): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dia = diaFixo && diaFixo > 0 ? diaFixo : d;
  const idx = (m - 1) + meses;
  const ty = y + Math.floor(idx / 12);
  const tm = ((idx % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}

/** `GetDocumentoSelecionado` (uAPagar.pas): o prefixo da duplicata pelo tipo do documento — os demais tipos ficam sem prefixo */
export function prefixoDuplicataApagar(tipodoc?: string | null): string {
  switch (String(tipodoc ?? '').trim().toUpperCase()) {
    case 'BOLETO': return 'BOL-';
    case 'DUPLICATA': return 'DUP-';
    case 'BANCÁRIA': case 'BANCARIA': return 'BAN-';
    case 'CARTEIRA': return 'CAR-';
    case 'JURÍDICA': case 'JURIDICA': return 'JUR-';
    case 'RH': return 'OUT-';
    default: return '';
  }
}

const brDe = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : String(iso ?? ''));

/** a OBS de cada parcela (`SetObs` + o texto digitado, :2171-2178) */
export function obsDaParcelaApagar(obsDigitada: string | null | undefined, i: number, n: number, nronf?: string | number | null, dtcompra?: string | null): string {
  const digitada = String(obsDigitada ?? '').trim();
  let texto = `PARCELA ${i} DE ${n}`;
  if (nronf != null && String(nronf).trim() !== '' && !digitada.includes('REFERENTE A NOTA FISCAL')) {
    texto += ` REFERENTE A NOTA FISCAL ${String(nronf).trim()} EMITIDA EM ${brDe(dtcompra)}`;
  }
  return digitada ? `${digitada} ${texto}` : texto;
}

/** o texto digitado da OBS de uma parcela gerada — tira o que o Processar acrescentou (para reprocessar o documento) */
export function obsDigitadaDaParcela(obs: string | null | undefined): string {
  return String(obs ?? '').replace(/\s*PARCELA \d+ DE \d+( REFERENTE A NOTA FISCAL .*)?$/i, '').trim();
}

export function planejarParcelasApagar(e: PlanoParcelasApagarEntrada): ParcelaApagarPlanejada[] {
  const n = Math.trunc(Number(e.nrodup) || 0);
  if (n < 1 || n > 200) throw new ErroPlanoParcelas('APAGAR_PARCELAS_NRODUP');
  const intervalo = Math.trunc(Number(e.intervalo) || 0);
  const diaFixo = Math.trunc(Number(e.diaFixo) || 0);
  if (!e.venc1 || !/^\d{4}-\d{2}-\d{2}/.test(e.venc1)) throw new ErroPlanoParcelas('APAGAR_PARCELAS_SEM_VENCIMENTO');
  if (n > 1 && intervalo <= 0 && diaFixo <= 0) throw new ErroPlanoParcelas('APAGAR_PARCELAS_SEM_CONFIG');
  const venc1 = e.venc1.slice(0, 10);
  // valores: total/N em centavos, o resíduo na 1ª (BuildParcelas) ou na última (a caixa "Incluir restantes na última parcela")
  const totalCents = Math.round(Number(e.total) * 100);
  if (!(totalCents > 0) || totalCents < n) throw new ErroPlanoParcelas('PARCELA_VALOR_INSUFICIENTE');
  const por = Math.floor(totalCents / n);
  const residuo = totalCents - por * n;
  const ondeResiduo = e.restantesNaUltima ? n - 1 : 0;
  // desconto e embutidos: cada parcela RoundTo(x/N, -2), o resíduo na última (:2180-2184)
  const descTotal = r2(Number(e.desconto) || 0);
  const vendTotal = r2(Number(e.vendor) || 0);
  const descPor = r2(descTotal / n);
  const vendPor = r2(vendTotal / n);
  const nronf = e.nronf != null && String(e.nronf).trim() !== '' ? String(e.nronf).trim() : '';
  const prefixo = String(e.modeloDuplicata ?? '') === '2' && nronf ? `${nronf}-` : prefixoDuplicataApagar(e.tipodoc);
  const digitada = String(e.duplicata ?? '').trim();
  const out: ParcelaApagarPlanejada[] = [];
  for (let i = 0; i < n; i++) {
    const ultima = i === n - 1;
    const dtvenc = intervalo > 0 ? somarDiasIso(venc1, i * intervalo) : somarMesesIso(venc1, i, diaFixo > 0 ? diaFixo : null);
    out.push({
      nrparcela: `${i + 1}/${n}`,
      duplicata: digitada && nronf && digitada === nronf ? digitada : `${prefixo}${pad3(i + 1)}/${pad3(n)}`,
      dtvenc,
      valor: (por + (i === ondeResiduo ? residuo : 0)) / 100,
      desconto: ultima ? r2(descTotal - descPor * (n - 1)) : descPor,
      vendor: ultima ? r2(vendTotal - vendPor * (n - 1)) : vendPor,
      obs: obsDaParcelaApagar(e.obs, i + 1, n, nronf || null, e.dtcompra),
    });
  }
  return out;
}
