/**
 * `NumeroExtenso(Valor, Moeda = False)` — a função que o legado registra no FastReport do recibo de adiantamento
 * (`FrxRelatorio.AddFunction`, uCadAdiantamentoFornecedor.pas:650). A implementação está no FuncoesApollo, que não veio no repositório:
 * aqui a escrita por extenso do português do Brasil ("cento e cinquenta", "mil e duzentos", "um milhão e…"). Com `Moeda`, "reais" e
 * "centavos"; sem moeda, a parte decimal sai como "vírgula <centavos>" — forma NÃO comprovada (93% dos adiantamentos da produção são
 * valores inteiros, o caso que o layout usa: "… no valor de 150,00 (cento e cinquenta) reais.").
 */
const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze',
  'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) partes.push(r < 20 ? UNIDADES[r] : DEZENAS[Math.floor(r / 10)] + (r % 10 ? ` e ${UNIDADES[r % 10]}` : ''));
  return partes.join(' e ');
}

export function inteiroPorExtenso(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'zero';
  const escalas: Array<[number, string, string]> = [[1e9, 'bilhão', 'bilhões'], [1e6, 'milhão', 'milhões'], [1e3, 'mil', 'mil'], [1, '', '']];
  const grupos: Array<{ texto: string; valor: number }> = [];
  let resto = n;
  for (const [v, sing, plur] of escalas) {
    const q = Math.floor(resto / v);
    resto %= v;
    if (!q) continue;
    const texto = v === 1 ? ate999(q) : v === 1e3 ? (q === 1 ? 'mil' : `${ate999(q)} mil`) : `${ate999(q)} ${q === 1 ? sing : plur}`;
    grupos.push({ texto, valor: q });
  }
  // liga com "e" o grupo menor que cem ou de centena redonda ("mil e cem", "mil e vinte", "dois milhões e quinhentos mil"); senão, espaço
  return grupos.map((g, k) => (k === 0 ? g.texto : `${g.valor < 100 || g.valor % 100 === 0 ? ' e ' : ' '}${g.texto}`)).join('');
}

export function numeroExtenso(valor: number, moeda = false): string {
  const neg = valor < 0;
  const centavos = Math.round(Math.abs(valor) * 100) % 100;
  const inteiro = Math.floor(Math.round(Math.abs(valor) * 100) / 100);
  let s: string;
  if (moeda) {
    const partes: string[] = [];
    if (inteiro) partes.push(`${inteiroPorExtenso(inteiro)} ${inteiro === 1 ? 'real' : 'reais'}`);
    if (centavos) partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
    s = partes.length ? partes.join(' e ') : 'zero reais';
  } else {
    s = inteiroPorExtenso(inteiro) + (centavos ? ` vírgula ${inteiroPorExtenso(centavos)}` : '');
  }
  return neg ? `menos ${s}` : s;
}
