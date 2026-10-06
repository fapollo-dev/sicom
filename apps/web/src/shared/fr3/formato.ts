/**
 * As rotinas de formatação do Delphi que os modelos do FastReport usam, com as convenções do Windows em pt-BR
 * (vírgula decimal, ponto de milhar, "R$ " na frente): `FormatFloat`, `Format` (%n %f %d %m %g %s %e), `FormatDateTime`
 * e o `DisplayFormat` dos memos.
 */
import { floatToStr, numero, texto, type Valor } from './expr';

export interface Separadores { decimal: string; milhar: string }
const PT: Separadores = { decimal: ',', milhar: '.' };

/** arredonda "meio para longe do zero" como o FloatToText do Delphi, sem o erro binário (2,675 → 2,68). */
function fixo(n: number, casas: number): string {
  const f = 10 ** casas;
  const r = Math.round((Math.abs(n) + Number.EPSILON * Math.abs(n)) * f) / f;
  return r.toFixed(casas);
}

function milhares(inteiro: string, sep: string): string {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** FormatFloat do Delphi: seções `positivo;negativo;zero`, `0` e `#`, `.` e `,`, literais entre aspas. */
export function formatFloat(fmt: string, valor: number, sep: Separadores = PT): string {
  const secoes: string[] = [];
  let atual = '';
  let aspas = '';
  for (const c of fmt) {
    if (aspas) { atual += c; if (c === aspas) aspas = ''; continue; }
    if (c === '"' || c === "'") { aspas = c; atual += c; continue; }
    if (c === ';') { secoes.push(atual); atual = ''; continue; }
    atual += c;
  }
  secoes.push(atual);
  let sec = secoes[0];
  let v = valor;
  if (v < 0 && secoes.length > 1 && secoes[1] !== '') { sec = secoes[1]; v = Math.abs(v); }
  if (v === 0 && secoes.length > 2 && secoes[2] !== '') sec = secoes[2];
  if (!sec) return floatToStr(valor);
  // separa prefixo literal, núcleo numérico e sufixo
  const ini = sec.search(/[0#.,]/);
  if (ini < 0) return sec.replace(/["']/g, '');
  let fim = ini;
  for (let i = ini; i < sec.length; i++) if (/[0#.,]/.test(sec[i])) fim = i + 1; else if (/[Ee]/.test(sec[i])) break;
  const prefixo = sec.slice(0, ini).replace(/["']/g, '');
  const sufixo = sec.slice(fim).replace(/["']/g, '');
  const nucleo = sec.slice(ini, fim);
  const [intPat, decPat = ''] = nucleo.split('.');
  const hasDec = nucleo.includes('.');
  const minDec = (decPat.match(/0/g) ?? []).length;
  const maxDec = (decPat.match(/[0#]/g) ?? []).length;
  const minInt = (intPat.match(/0/g) ?? []).length;
  // a vírgula em QUALQUER posição da seção liga o milhar (FloatToTextFmt: '0.00,' = 1.234,50 — o BalanceteVerificacao.fr3)
  const agrupa = nucleo.includes(',');
  let s = fixo(v, hasDec ? maxDec : 0);
  let [ip, dp = ''] = s.split('.');
  while (dp.length > minDec && dp.endsWith('0')) dp = dp.slice(0, -1);
  if (ip === '0' && minInt === 0) ip = '';
  if (ip.length < minInt) ip = ip.padStart(minInt, '0');
  if (agrupa) ip = milhares(ip, sep.milhar);
  const neg = v < 0 && Number(s) !== 0 ? '-' : '';
  s = neg + ip + (dp ? sep.decimal + dp : '');
  return prefixo + s + sufixo;
}

/** Format do Delphi (um único argumento — é o que o DisplayFormat usa): %[-][largura][.precisão]tipo. */
export function formatDelphi(fmt: string, valor: Valor, sep: Separadores = PT): string {
  return fmt.replace(/%(-?)(\d*)(?:\.(\d+))?([dunfgmesx%])/gi, (_m, esq: string, larg: string, prec: string, tipo: string) => {
    const t = tipo.toLowerCase();
    if (t === '%') return '%';
    const n = numero(valor);
    let s: string;
    switch (t) {
      case 'd': case 'u': s = String(Math.trunc(n)); if (prec) s = s.padStart(Number(prec), '0'); break;
      case 'f': s = fixo(n, prec ? Number(prec) : 2).replace('.', sep.decimal); if (n < 0) s = '-' + s; break;
      case 'n': {
        const [ip, dp] = fixo(n, prec ? Number(prec) : 2).split('.');
        s = (n < 0 ? '-' : '') + milhares(ip, sep.milhar) + (dp ? sep.decimal + dp : '');
        break;
      }
      case 'm': {
        const [ip, dp] = fixo(n, prec ? Number(prec) : 2).split('.');
        s = `${n < 0 ? '-' : ''}R$ ${milhares(ip, sep.milhar)}${dp ? sep.decimal + dp : ''}`;
        break;
      }
      case 'e': s = n.toExponential(prec ? Number(prec) - 1 : 14).replace('.', sep.decimal); break;
      case 'g': s = floatToStr(prec ? Number(n.toPrecision(Number(prec))) : n).replace(',', sep.decimal); break;
      case 'x': s = Math.trunc(n).toString(16).toUpperCase(); break;
      default: s = texto(valor); if (prec) s = s.slice(0, Number(prec));
    }
    const w = larg ? Number(larg) : 0;
    return s.length >= w ? s : esq ? s.padEnd(w) : s.padStart(w);
  });
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** FormatDateTime do Delphi (pt-BR): d dd ddd dddd m mm mmm mmmm yy yyyy h hh n nn s ss, "m" depois de "h" = minuto. */
export function formatDateTime(fmt: string, d: Date): string {
  let out = '';
  let i = 0;
  let depoisDeHora = false;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c === '"' || c === "'") { const j = fmt.indexOf(c, i + 1); out += fmt.slice(i + 1, j < 0 ? fmt.length : j); i = j < 0 ? fmt.length : j + 1; continue; }
    const run = /^(d+|m+|y+|h+|n+|s+|z+)/i.exec(fmt.slice(i));
    if (!run) { out += c === '/' ? '/' : c === ':' ? ':' : c; i++; continue; }
    const tok = run[0].toLowerCase();
    i += tok.length;
    switch (tok[0]) {
      case 'd': out += tok.length === 1 ? String(d.getDate()) : tok.length === 2 ? p2(d.getDate()) : tok.length === 3 ? DIAS[d.getDay()].slice(0, 3) : DIAS[d.getDay()]; depoisDeHora = false; break;
      case 'm':
        if (depoisDeHora && tok.length <= 2) { out += tok.length === 1 ? String(d.getMinutes()) : p2(d.getMinutes()); depoisDeHora = false; break; }
        out += tok.length === 1 ? String(d.getMonth() + 1) : tok.length === 2 ? p2(d.getMonth() + 1) : tok.length === 3 ? MESES[d.getMonth()].slice(0, 3) : MESES[d.getMonth()];
        break;
      case 'y': out += tok.length <= 2 ? p2(d.getFullYear() % 100) : String(d.getFullYear()); break;
      case 'h': out += tok.length === 1 ? String(d.getHours()) : p2(d.getHours()); depoisDeHora = true; break;
      case 'n': out += tok.length === 1 ? String(d.getMinutes()) : p2(d.getMinutes()); break;
      case 's': out += tok.length === 1 ? String(d.getSeconds()) : p2(d.getSeconds()); break;
      case 'z': out += String(d.getMilliseconds()).padStart(3, '0'); break;
    }
  }
  return out;
}

/** o DisplayFormat de um memo aplicado ao valor de uma expressão (TfrxMemoView.FormatData). */
export function aplicarDisplayFormat(valor: Valor, kind: string | undefined, fmtStr: string | undefined, sep: Separadores): string {
  if (!kind || kind === 'fkText' || !fmtStr) return texto(valor);
  if (kind === 'fkNumeric') {
    if (typeof valor !== 'number') return texto(valor);
    return fmtStr.includes('%') ? formatDelphi(fmtStr, valor, sep) : formatFloat(fmtStr, valor, sep);
  }
  if (kind === 'fkDateTime') return valor instanceof Date ? formatDateTime(fmtStr, valor) : texto(valor);
  if (kind === 'fkBoolean') {
    const [f, v] = fmtStr.split(',');
    return typeof valor === 'boolean' ? (valor ? v ?? 'True' : f ?? 'False') : texto(valor);
  }
  return texto(valor);
}
