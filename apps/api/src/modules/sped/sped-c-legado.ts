/**
 * As regras do BLOCO C do SPED Fiscal do legado (Uspedfiscal.pas + UdmSpedFiscal.dfm) que o Apollo não tinha — recon de 25/09/2026
 * (`scratchpad/recon-sped-c170`), com as opções da tela no padrão do .dfm (não são persistidas):
 *  - CST_ICMS = `FormatFloat('000', NF_PROD.CST)` (Uspedfiscal.pas:2789, :3158). O Apollo montava ORIGEM_ESTOQUE[0] + CST, e a coluna é
 *    'E' em 100% dos itens: "E60", que o PVA rejeita;
 *  - o ICMS do item (BC, alíquota = ICME, valor) é ZERADO quando o CFOP é de cupom (CFOP.PROC_CUPOM), x933/x556, x101/x102 com CST 40/90,
 *    ou a alíquota não é T* nem STB (adqNFprod, UdmSpedFiscal.dfm:2918-2975) — R$ 28,1 mil de crédito a mais em 8 meses no Apollo;
 *    entrada de fornecedor do Simples também zera (Uspedfiscal.pas:2725);
 *  - o C190 agrupa por CST, CFOP e o ICME já zerado, com VL_OPR = Σ[(custo − desconto%) × qtd + despesas + IPI% + frete% + ST + FCP-ST]
 *    (adqAnaliticoNF, dfm:3301-3476), VL_RED_BC nos CST 20/70 (pas:3128-3142) e o x929 sem ICMS (pas:3111).
 * Onde o legado erra, NÃO se copia (e fica escrito): o VL_RED_BC que ele herda do grupo anterior (a variável não é zerada para os CST
 * fora de 10/20/60/70/90) sai 0.
 */
const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const r3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000;
const r6 = (x: number) => Math.round((x + Number.EPSILON) * 1e6) / 1e6;

export interface ItemSpedLegado {
  cst?: unknown;
  cfop?: unknown;
  aliquota?: unknown;
  icme?: unknown;
  vrbasecalculo?: unknown;
  vricm?: unknown;
  bcr?: unknown;
  quantidade?: unknown;
  vrcusto?: unknown;
  desconto?: unknown;
  depsacess?: unknown;
  ipi?: unknown;
  frete?: unknown;
  vricmst?: unknown;
  fcp_valor_st?: unknown;
  proc_cupom?: unknown;
  gera_sped?: unknown;
}

/** o CST de 3 dígitos do legado (`FormatFloat('000', CST)`) */
export const cst3 = (cst: unknown): string => String(Math.trunc(n(cst))).padStart(3, '0');

const sub = (cfop: unknown) => String(cfop ?? '').slice(1, 4);

/** o ICMS do item cai? (a CASE do adqNFprod/adqAnaliticoNF — `semAliquota` inclui a regra da alíquota, que o BCR não tem) */
export function icmsZeradoNoSped(it: ItemSpedLegado, semAliquota = true): boolean {
  if (String(it.proc_cupom ?? '').toUpperCase() === 'S') return true;
  if (['933', '556'].includes(sub(it.cfop))) return true;
  if (['102', '101'].includes(sub(it.cfop)) && [40, 90].includes(Math.trunc(n(it.cst)))) return true;
  if (!semAliquota) return false;
  const aliq = String(it.aliquota ?? '').trim().toUpperCase();
  return !(aliq.startsWith('T') || aliq === 'STB');
}

/** BC, alíquota (o ICME) e valor do ICMS do item no C170/C100 */
export function icmsDoItem(it: ItemSpedLegado, fornecedorSimples: boolean): { bc: number; aliq: number; vl: number } {
  if (fornecedorSimples || icmsZeradoNoSped(it)) return { bc: 0, aliq: 0, vl: 0 };
  return { bc: r2(n(it.vrbasecalculo)), aliq: r2(n(it.icme)), vl: r2(n(it.vricm)) };
}

/** a base do item com o desconto percentual, como o SQL do legado (NUMERIC(15,6) no desconto, NUMERIC(13,3) na quantidade) */
const baseComDesconto = (it: ItemSpedLegado) => (n(it.vrcusto) - r6((n(it.vrcusto) * r6(n(it.desconto))) / 100)) * r3(n(it.quantidade));

export interface GrupoC190 {
  cst: string;
  cfop: string;
  aliq: number;
  vlOpr: number;
  bc: number;
  vl: number;
  vlRedBc: number;
  vlIpi: number;
}

/**
 * Os grupos do C190 de uma nota: só os itens de CFOP que gera SPED; subgrupo (CST, CFOP, ICME zerado, cupom, alíquota) como o SQL interno,
 * grupo (CST, CFOP, ICME zerado) como o externo — o BCR é a média das médias, como lá.
 */
export function gruposC190(itens: ItemSpedLegado[], stExterno: boolean, fornecedorSimples: boolean): GrupoC190[] {
  const subgrupos = new Map<string, { cst: string; cfop: string; icme: number; itens: ItemSpedLegado[] }>();
  for (const it of itens) {
    if (String(it.gera_sped ?? 'S').toUpperCase() === 'N') continue;
    const icme = icmsZeradoNoSped(it) ? 0 : r2(n(it.icme));
    const k = [cst3(it.cst), String(it.cfop ?? ''), icme.toFixed(2), String(it.proc_cupom ?? ''), String(it.aliquota ?? '').trim()].join('|');
    const s = subgrupos.get(k) ?? { cst: cst3(it.cst), cfop: String(it.cfop ?? ''), icme, itens: [] };
    s.itens.push(it);
    subgrupos.set(k, s);
  }
  const grupos = new Map<string, { g: GrupoC190; valor: number; bcrs: number[]; basered: number }>();
  for (const s of subgrupos.values()) {
    const primeiro = s.itens[0];
    const zeraTudo = icmsZeradoNoSped(primeiro);
    const zeraBcr = icmsZeradoNoSped(primeiro, false);
    let valor = 0;
    let ipi = 0;
    let bc = 0;
    let vl = 0;
    let basered = 0;
    let bcrSoma = 0;
    for (const it of s.itens) {
      const b = baseComDesconto(it);
      valor += b + n(it.depsacess) + (r3(n(it.ipi)) * b) / 100 + (r3(n(it.frete)) * r2(b)) / 100 + r2(stExterno ? 0 : n(it.vricmst)) + n(it.fcp_valor_st);
      ipi += (n(it.ipi) * r2((n(it.vrcusto) - (n(it.vrcusto) * r2(n(it.desconto))) / 100) * n(it.quantidade))) / 100;
      bc += n(it.vrbasecalculo);
      vl += n(it.vricm);
      basered += n(it.vrbasecalculo);
      bcrSoma += n(it.bcr);
    }
    const k = `${s.cst}|${s.cfop}|${s.icme.toFixed(2)}`;
    const acc = grupos.get(k) ?? { g: { cst: s.cst, cfop: s.cfop, aliq: s.icme, vlOpr: 0, bc: 0, vl: 0, vlRedBc: 0, vlIpi: 0 }, valor: 0, bcrs: [], basered: 0 };
    acc.valor += valor;
    acc.g.vlIpi = r2(acc.g.vlIpi + r2(ipi));
    acc.g.bc = r2(acc.g.bc + (zeraTudo ? 0 : r2(bc)));
    acc.g.vl = r2(acc.g.vl + (zeraTudo ? 0 : r2(vl)));
    acc.bcrs.push(zeraBcr ? 0 : r2(bcrSoma / s.itens.length));
    acc.basered += basered;
    grupos.set(k, acc);
  }
  const out: GrupoC190[] = [];
  for (const { g, valor, bcrs, basered } of grupos.values()) {
    g.vlOpr = r2(valor);
    const bcr = bcrs.reduce((a, b) => a + b, 0) / (bcrs.length || 1);
    const cstN = Number(g.cst);
    if (sub(g.cfop) === '929' || fornecedorSimples) {
      // o x929 e a entrada do Simples saem sem ICMS (pas:3111-3154); o VL_OPR fica
      g.bc = 0; g.vl = 0; g.aliq = 0; g.vlRedBc = 0;
    } else if ([20, 70].includes(cstN) && bcr > 0 && bcr < 100) {
      g.vlRedBc = r2(basered / (bcr / 100) - basered);
    } else {
      g.vlRedBc = 0; // CST 10/60/90: 0 no legado; os demais herdam o do grupo anterior lá (bug) — aqui 0
    }
    out.push(g);
  }
  return out;
}
