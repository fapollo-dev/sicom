/**
 * EFD-CONTRIBUIÇÕES — o bloco C das notas (C100/C170) como o legado o monta (`UspedPisCofins.pas:882-986`; as queries `FDqNF` e
 * `FDqNFprod` do `UdmSpedPisCofins.dfm:1758-2856`). Recon: `Uspedfiscal-blocoC.md` §8 e o corte J.
 *  - C170: o CST e as alíquotas de PIS/COFINS saem do PISCOFINS do item (ou do produto) por um CASE de CFOP — entrada sem crédito
 *    (1407/1556/1653/1908/1910/2556/2910/1949 → CST 74, alíquota 0); devolução de venda (1202/2202/1411/2411 → a alíquota de SAÍDA, CST 50
 *    quando o CST de entrada é 60); fornecedor pessoa física/produtor rural com CST de crédito, ou CFOP fora do PC_CONFIG → 74 e 0; na
 *    saída, 5927/5929 → 08 e 0, venda/devolução de compra ou CFOP no PC_CONFIG → o cadastro, senão 08. Um CST só (o de COFINS) vai nos
 *    dois campos, como o legado;
 *  - a base (BASECOFINS) = produto − desconto + despesas + seguro% + frete% (− o ICMS com ABATER_ICMS_BASE_CALCULO_PIS_COFINS na saída);
 *    VL_BC = 0 com alíquota 0; VL = round(base × alíquota / 100, 2);
 *  - o ICMS do C170 só com a alíquota tributada ('T…') e fora do PROC_CUPOM; o x929 zera;
 *  - o PIS/COFINS do C100 é outra conta (a do cabeçalho): produto − desconto% + ST + despesas + outras + frete% + IPI%, com a alíquota
 *    escolhida pelo TIPO DE EMISSÃO (própria → as regras de saída; terceiros → as de entrada), item a item arredondado.
 */
const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};
export const r2 = (x: number): number => (Math.round(Math.abs(x) * 100 + 1e-9) / 100) * (x < 0 ? -1 : 1);

export const PC_ENTRADA_SEM_CREDITO = [1407, 1556, 1653, 1908, 1910, 2556, 2910, 1949];
export const PC_DEVOLUCAO_VENDA = [1202, 2202, 1411, 2411];
export const PC_SAIDA_TRIBUTADA = [5202, 6202, 5411, 6411, 5102, 6102, 5403, 6403];
const CST_CREDITO = [50, 51, 52, 53, 54, 55, 56, 60];

export interface PisCofinsCadastro {
  aliq_pis_ent?: unknown; aliq_pis_sai?: unknown; aliq_cofins_ent?: unknown; aliq_cofins_sai?: unknown;
  cst_pis_ent?: unknown; cst_pis_sai?: unknown; cst_cofins_ent?: unknown; cst_cofins_sai?: unknown;
}

const pfOuProdutor = (tipofj: unknown) => ['F', 'R'].includes(String(tipofj ?? '').trim().toUpperCase());

/** o CST (o de COFINS, que o legado põe nos dois campos) e as alíquotas do C170 — o CASE do FDqNFprod */
export function pisCofinsDoItemC170(cfop: number, tipoNota: string, tipofj: unknown, pc: PisCofinsCadastro, pcConfig: Set<number>): { cst: number; aliqPis: number; aliqCofins: number } {
  if (tipoNota === 'S') {
    if ([5927, 5929].includes(cfop)) return { cst: 8, aliqPis: 0, aliqCofins: 0 };
    if (PC_SAIDA_TRIBUTADA.includes(cfop) || pcConfig.has(cfop)) return { cst: n(pc.cst_cofins_sai), aliqPis: n(pc.aliq_pis_sai), aliqCofins: n(pc.aliq_cofins_sai) };
    return { cst: 8, aliqPis: 0, aliqCofins: 0 };
  }
  if (PC_ENTRADA_SEM_CREDITO.includes(cfop)) return { cst: 74, aliqPis: 0, aliqCofins: 0 };
  const cstPisEnt = n(pc.cst_pis_ent);
  const devolucao = PC_DEVOLUCAO_VENDA.includes(cfop);
  const semCredito = (pfOuProdutor(tipofj) && CST_CREDITO.includes(cstPisEnt)) || !pcConfig.has(cfop);
  const aliqPis = devolucao ? n(pc.aliq_pis_sai) : semCredito ? 0 : n(pc.aliq_pis_ent);
  const aliqCofins = devolucao ? n(pc.aliq_cofins_sai) : semCredito ? 0 : n(pc.aliq_cofins_ent);
  let cst: number;
  if (devolucao && cstPisEnt === 60) cst = 50;
  else if ((pfOuProdutor(tipofj) && !devolucao && CST_CREDITO.includes(cstPisEnt)) || !pcConfig.has(cfop)) cst = 74;
  else cst = n(pc.cst_cofins_ent);
  return { cst, aliqPis, aliqCofins };
}

/** BASECOFINS do C170 */
export function baseCofinsC170(it: Record<string, unknown>, tipoNota: string, abaterIcms: boolean, aliqCofinsSai: number): number {
  const bruto = n(it.vrcusto) * n(it.quantidade) - n(it.vrdescprod);
  const base = r2(bruto + n(it.depsacess) + (n(it.seguro) * bruto) / 100 + (n(it.frete) * bruto) / 100);
  return r2(base - (abaterIcms && aliqCofinsSai > 0 && tipoNota === 'S' ? n(it.vricm) : 0));
}

/** o ICMS do C170: só a alíquota tributada e fora do PROC_CUPOM; o x929 zera */
export function icmsDoItemC170(it: Record<string, unknown>, procCupom: boolean): { bc: number; aliq: number; valor: number } {
  if (String(it.cfop ?? '').includes('929')) return { bc: 0, aliq: 0, valor: 0 };
  const tributado = !procCupom && String(it.aliquota ?? '').trim().toUpperCase().startsWith('T');
  return tributado ? { bc: r2(n(it.vrbasecalculo)), aliq: r2(n(it.icme)), valor: r2(n(it.vricm)) } : { bc: 0, aliq: 0, valor: 0 };
}

/** o PIS/COFINS do C100 (VALORPIS/VALORCOFINS do FDqNF), item a item, sem os itens 5929/6929 */
export function pisCofinsDoCabecalho(
  itens: Array<{ it: Record<string, unknown>; pc: PisCofinsCadastro }>, tipoNota: string, tipoemissao: string, tipofj: unknown, pcConfig: Set<number>, abaterIcms: boolean,
): { pis: number; cofins: number } {
  let pis = 0;
  let cofins = 0;
  for (const { it, pc } of itens) {
    const cfop = n(it.cfop);
    if ([5929, 6929].includes(cfop)) continue;
    const vc = n(it.vrcusto) * n(it.quantidade);
    const desc = r2(n(it.desconto));
    const liquido = vc - r2((vc * desc) / 100);
    const baseItem = r2((n(it.vrcusto) - (n(it.vrcusto) * desc) / 100) * n(it.quantidade));
    const expr = r2(liquido + n(it.vricmst) + n(it.depsacess) + n(it.vroutrasdesp) + (n(it.frete) * baseItem) / 100 + (n(it.ipi) * baseItem) / 100);
    const base = r2(expr - (abaterIcms && n(pc.aliq_cofins_sai) > 0 && tipoNota === 'S' ? n(it.vricm) : 0));
    let aPis: number;
    let aCof: number;
    if (String(tipoemissao).trim() === '0') {
      const tributa = (lista: number[]) => lista.includes(cfop) || pcConfig.has(cfop);
      const baseLista = [...PC_SAIDA_TRIBUTADA, ...PC_DEVOLUCAO_VENDA];
      aPis = [5927, 5929].includes(cfop) ? 0 : tributa([...baseLista, 5927]) ? n(pc.aliq_pis_sai) : 0;
      aCof = [5927, 5929].includes(cfop) ? 0 : tributa(baseLista) ? n(pc.aliq_cofins_sai) : 0;
    } else {
      const zero = PC_ENTRADA_SEM_CREDITO.includes(cfop) || (pfOuProdutor(tipofj) && CST_CREDITO.includes(n(pc.cst_pis_ent))) || !pcConfig.has(cfop);
      aPis = zero ? 0 : n(pc.aliq_pis_ent);
      aCof = zero ? 0 : n(pc.aliq_cofins_ent);
    }
    pis += r2((base * aPis) / 100);
    cofins += r2((base * aCof) / 100);
  }
  return { pis: r2(pis), cofins: r2(cofins) };
}

/** IND_FRT (GetIndFrete, UspedPisCofins.pas:2215): 0-4 e 9 como vêm; o resto sai vazio (o nulo lido como 0) */
export const indFreteC100 = (tipofrete: unknown): string => {
  const v = n(tipofrete);
  return [0, 1, 2, 3, 4, 9].includes(v) ? String(v) : '';
};
