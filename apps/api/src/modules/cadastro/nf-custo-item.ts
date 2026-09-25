/**
 * O CUSTO DO ITEM DE ENTRADA como o legado o calcula — `TDMNF.CalcValorNota` (ramo de entrada, udmNF.pas:3928-4261) seguido de
 * `TDMNF.CalcValorCusto` (:3773-3926) — e a ESCADA DE MARGEM do diálogo do item (`TfrmItensNF.MargemL`, uItensNF.pas:3312-3366).
 * É o que o diálogo grava no item (CUSTO_REAL_UNIT, VRCUSTOREP, VRCUSTOCSI, PMZ, VRVENDASUG, VRAJCUSTODEC47530 e os lucros) e o que o
 * processamento usa quando o item não tem o valor gravado (os TEMP, udmNF.pas:6924-6945).
 * Conferido contra a produção (13.103 itens de entrada processados de ago-set/2026, recon `uEstoqueNF-UpdateProdutos.md`): custo real
 * 99,2%, reposição 98,2%, CSI 98,1%, PMZ 98,8%, créditos de ICMS 100% e de PIS/COFINS 99,99%; a escada 99-100% nos valores.
 */

import { configNaTrx } from '../compras/pedido-heranca';
import { FiscalPricingService } from '../precificacao/preco-fiscal.service';
import { currentTenant } from '../../shared/tenant/tenant-context';

const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};
/** `TruncarArredondar(x, 'A', 2)` — arredonda meio para cima */
export const arred = (x: number, casas = 2): number => {
  const m = 10 ** casas;
  return (Math.floor(Math.abs(x) * m + 0.5 + 1e-9) / m) * (x < 0 ? -1 : 1);
};
/** `TruncarArredondar(x, 'T', 2)` — trunca */
const trunca = (x: number, casas = 2): number => {
  const m = 10 ** casas;
  return (Math.floor(Math.abs(x) * m + 1e-9) / m) * (x < 0 ? -1 : 1);
};
/** o campo Currency do Delphi guarda 4 casas */
const cur = (x: number) => Math.round((x + Number.EPSILON) * 1e4) / 1e4;

export interface ItemCustoEntrada {
  quantidade?: unknown;
  fatorembal?: unknown;
  vrcusto?: unknown;
  vrcustoreal?: unknown;
  desconto?: unknown;
  arredonda?: unknown;
  icme?: unknown;
  bcr?: unknown;
  cfop?: unknown;
  cst?: unknown;
  aliquota?: unknown;
  depsacess?: unknown;
  ipi?: unknown;
  ipi_devolucao?: unknown;
  frete?: unknown;
  seguro?: unknown;
  frete2?: unknown;
  despextra?: unknown;
  vroutrasdesp?: unknown;
  vricmst?: unknown;
  streal?: unknown;
  fcp_valor_st?: unknown;
  bonificacao?: unknown;
  vrcustoajustenf?: unknown;
  aliqpise?: unknown;
  aliqcofinse?: unknown;
  aliqpiss?: unknown;
  aliqcofinss?: unknown;
  icms?: unknown;
  vrvenda?: unknown;
  vrbase_stexterno?: unknown;
  vrbasecalculo?: unknown;
  icms_nota_bc?: unknown;
  icms_nota_valor?: unknown;
  geraicm_ipi?: unknown;
  geraicm_acess?: unknown;
  geraicm_frete?: unknown;
}

export interface EmpresaCusto {
  classfiscal?: unknown;
  despfederativas?: unknown;
  despoperacional?: unknown;
  alqsimplesnac?: unknown;
  imprenda?: unknown;
  contsocial?: unknown;
  uf?: unknown;
}

export interface ContextoCustoEntrada {
  /** o CFOP do CABEÇALHO (x929 conta a quantidade sem o fator, udmNF.pas:3950) */
  cfopNota?: unknown;
  /** APROVEITAMENTO_CREDITO_ICMSST_NF = 'S' desliga as zeragens do ICME (produção 'N') */
  aproveitamentoCreditoIcmsSt?: boolean;
  /** nota importada de um item só: o total do produto encosta no da nota (até 0,02 — udmNF.pas:4003-4010) */
  totalProdNotaUmItem?: number | null;
  /** a alíquota interna do indexador do item (ou a do ST da nota), para o ajuste do Decreto 47.530 de MG */
  aliqInternaIndexador?: number | null;
}

export interface CustoItemEntrada {
  qtdetotal: number;
  vrcustofinal: number;
  vrcustofinalc: number;
  totalprods: number;
  vrfrete: number;
  vrseguro: number;
  vripi: number;
  tempicmeefetivo: number;
  tempbaseicme: number;
  vricmCalc: number;
  creditoIcm: number;
  creditoPis: number;
  tempvrcusto: number;
  tempvrcustorep: number;
  tempvrcustocsi: number;
  temppmz: number;
  tempvrajcusto47530: number;
}

const sub = (cfop: unknown) => String(cfop ?? '').slice(1, 4);

export function custoDoItemNaEntrada(it: ItemCustoEntrada, emp: EmpresaCusto, ctx: ContextoCustoEntrada = {}): CustoItemEntrada {
  const fator = n(it.fatorembal) || 1;
  const qtdetotal = sub(ctx.cfopNota) === '929' ? n(it.quantidade) : cur(n(it.quantidade) * fator);
  const desconto = n(it.desconto);
  // o custo real é o que o operador digita no diálogo (uItensNF.dfm:2536; a importação traz o vUnCom) — 0 em 2 de 60.717 itens de 2026; a
  // tela do Apollo não tem o campo, então sem ele vale o custo da nota
  const vrcustoreal = n(it.vrcustoreal) > 0 ? n(it.vrcustoreal) : n(it.vrcusto);
  const vrcustofinal = (vrcustoreal - (vrcustoreal * desconto) / 100) / fator;
  const vrcustofinalc = (n(it.vrcusto) - (n(it.vrcusto) * desconto) / 100) / fator;
  const arredonda = String(it.arredonda ?? 'S').toUpperCase() !== 'N';
  let totalprods = (arredonda ? arred : trunca)(qtdetotal * vrcustofinalc, 2);
  if (ctx.totalProdNotaUmItem != null && Math.abs(totalprods - ctx.totalProdNotaUmItem) <= 0.02) totalprods = ctx.totalProdNotaUmItem;
  const pct = (p: unknown) => cur((totalprods * n(p)) / 100);
  const vrfrete = pct(it.frete);
  const vrseguro = pct(it.seguro);
  const despextrap = pct(it.despextra);
  const vripi = arred((totalprods * n(it.ipi)) / 100, 2);
  const vripiDev = arred((totalprods * n(it.ipi_devolucao)) / 100, 2);
  // a base do ICMS da entrada (TEMPBASEICME) com o complemento de IPI/acessórias/frete, e o valor pela alíquota do ICME (:4185-4219)
  let complemento = 0;
  if (String(it.geraicm_ipi ?? '') === 'S') complemento += vripi;
  if (String(it.geraicm_acess ?? '') === 'S') complemento += (n(it.depsacess) * n(it.bcr)) / 100;
  if (String(it.geraicm_frete ?? '') === 'S') complemento += vrfrete;
  let tempbaseicme = arredonda ? arred((totalprods * n(it.bcr)) / 100 + complemento, 2) : (totalprods * n(it.bcr)) / 100 + complemento;
  if (n(it.icms_nota_bc) > 0 && Math.abs(n(it.icms_nota_bc) - tempbaseicme) <= 0.01) tempbaseicme = n(it.icms_nota_bc);
  let tempicmeefetivo = arred((n(it.icme) / 100) * n(it.bcr), 2);
  let aliqIcme = n(it.icme);
  const cst = Math.trunc(n(it.cst));
  const aliquota = String(it.aliquota ?? '').trim().toUpperCase();
  if (!ctx.aproveitamentoCreditoIcmsSt && (['401', '403', '933', '556'].includes(sub(it.cfop))
    || (['102', '101'].includes(sub(it.cfop)) && (cst === 40 || cst === 90))
    || (['1910', '2910'].includes(String(it.cfop ?? '')) && !aliquota.startsWith('T')))) {
    tempicmeefetivo = 0;
    aliqIcme = 0;
    tempbaseicme = 0;
  }
  // o VRICM_CALC do gravar (uNF.pas:4920-4925): a base pela alíquota do ICME, arredondada ou truncada conforme o ARREDONDA
  const vricmCalc = (arredonda ? arred : trunca)(tempbaseicme * (aliqIcme / 100), 2);

  // CalcValorCusto
  const sn = String(emp.classfiscal ?? '').trim().toUpperCase() === 'SN';
  const lr = String(emp.classfiscal ?? '').trim().toUpperCase() === 'LR';
  const creditoIcm = !sn && aliquota.startsWith('T') ? arred((tempicmeefetivo * vrcustofinal) / 100, 2) : 0;
  const creditoPis = !sn && lr && n(it.aliqpise) > 0 ? arred(((n(it.aliqpise) + n(it.aliqcofinse)) * vrcustofinal) / 100, 2) : 0;
  const st = n(it.vricmst) > 0 && n(it.streal) === 0 ? n(it.vricmst) : n(it.streal);
  const fcpst = n(it.fcp_valor_st) > 0 ? n(it.fcp_valor_st) : 0;
  let tempvrajcusto47530 = 0;
  if (String(emp.uf ?? '').trim().toUpperCase() === 'MG' && n(it.vrbase_stexterno) > 0 && qtdetotal > 0) {
    tempvrajcusto47530 = arred((((n(it.vrbase_stexterno) / qtdetotal) - n(it.vrvenda)) * n(ctx.aliqInternaIndexador)) / 100, 2);
  }
  if (!(qtdetotal > 0)) {
    return { qtdetotal, vrcustofinal, vrcustofinalc, totalprods, vrfrete, vrseguro, vripi, tempicmeefetivo, tempbaseicme, vricmCalc, creditoIcm: 0, creditoPis: 0,
      tempvrcusto: 0, tempvrcustorep: 0, tempvrcustocsi: 0, temppmz: 0, tempvrajcusto47530: 0 };
  }
  const q = qtdetotal;
  const soma = vrcustofinal + n(it.depsacess) / q + vrseguro / q + vrfrete / q + vripi / q + vripiDev / q + n(it.vroutrasdesp) / q + st / q + fcpst / q
    + (n(emp.despfederativas) * vrcustofinal) / 100 + despextrap / q + (n(it.frete2) * vrcustofinal) / 100 + n(it.vrcustoajustenf) / q;
  const tempvrcusto = arred(soma - creditoPis - creditoIcm, 2);
  const tempvrcustorep = arred(soma - n(it.bonificacao), 2);
  const tempvrcustocsi = tempvrcustorep - creditoIcm - creditoPis;
  const aliqSaida = aliquota.startsWith('T') ? n(it.icms) : 0;
  const margemZero = 100 - (n(it.aliqpiss) + n(it.aliqcofinss) + aliqSaida + n(emp.despoperacional));
  const temppmz = margemZero !== 0 ? (tempvrcusto / margemZero) * 100 : 0;
  return { qtdetotal, vrcustofinal, vrcustofinalc, totalprods, vrfrete, vrseguro, vripi, tempicmeefetivo, tempbaseicme, vricmCalc, creditoIcm, creditoPis,
    tempvrcusto, tempvrcustorep, tempvrcustocsi, temppmz, tempvrajcusto47530 };
}

export interface MargemItem {
  debitoicm: number;
  debitopiscofins: number;
  vendaliq: number;
  lucrobrutov: number;
  lucrobrutop: number;
  despopv: number;
  lucroliqv: number;
  lucroliqp: number;
  imprend: number;
  contsocial: number;
  margeml2v: number;
  markupl2: number;
}

/** a escada do diálogo (`MargemL`) sobre o preço de venda do item e o custo real (TEMPVRCUSTO) */
export function margemDoItem(it: ItemCustoEntrada, custoReal: number, emp: EmpresaCusto): MargemItem {
  const venda = n(it.vrvenda);
  const sn = String(emp.classfiscal ?? '').trim().toUpperCase() === 'SN';
  const aliquota = String(it.aliquota ?? '').trim().toUpperCase();
  const icm = sn ? arred((n(emp.alqsimplesnac) * venda) / 100) : aliquota.startsWith('T') ? arred((n(it.icms) * venda) / 100) : 0;
  const pis = sn ? 0 : n(it.aliqpiss) > 0 ? arred(((n(it.aliqpiss) + n(it.aliqcofinss)) * venda) / 100) : 0;
  const o: MargemItem = { debitoicm: icm, debitopiscofins: pis, vendaliq: 0, lucrobrutov: 0, lucrobrutop: 0, despopv: 0, lucroliqv: 0, lucroliqp: 0,
    imprend: 0, contsocial: 0, margeml2v: 0, markupl2: 0 };
  if (venda > 0) {
    const liq = venda - icm - pis;
    o.vendaliq = arred(liq);
    o.lucrobrutov = arred(liq - custoReal - n(it.bonificacao));
    o.lucrobrutop = liq !== 0 ? arred(((liq - custoReal - n(it.bonificacao)) / liq) * 100) : 0;
    o.despopv = arred((venda * n(emp.despoperacional)) / 100);
    o.lucroliqv = arred(o.lucrobrutov - o.despopv);
    o.lucroliqp = arred((o.lucroliqv / venda) * 100);
  }
  if (o.lucroliqv > 0) {
    o.imprend = arred((o.lucroliqv * n(emp.imprenda)) / 100);
    o.contsocial = arred((o.lucroliqv * n(emp.contsocial)) / 100);
  }
  if (venda > 0) {
    o.margeml2v = arred(o.lucroliqv - o.imprend - o.contsocial);
    o.markupl2 = arred((o.margeml2v / venda) * 100);
  }
  return o;
}

// ─────────────────────────── a gravação no item (o OK do diálogo / a análise automática da importação) ───────────────────────────


type AnyDB = any;
const fiscal = new FiscalPricingService();

/**
 * Grava no item de ENTRADA o que o diálogo grava no OK (uItensNF.pas:1552-1609): CUSTO_REAL_UNIT (quando > 0), VRCUSTOREP, VRCUSTOCSI, PMZ,
 * VRVENDASUG (o `TMargemPreco` com o custo real — o de reposição com TIPO_PRECIFICACAO D/M — e o MARKUP do item), VRAJCUSTODEC47530 e a
 * escada do `MargemL`; e, em TODO item, o VRBASECALCULOICM_CALC/VRICM_CALC que o gravar da nota repete (uNF.pas:4920-4925).
 * `pendentes`: só os itens sem análise (CUSTO_REAL_UNIT 0 — o item novo nasce com 0, e o agregado zera o que passou pelo diálogo);
 * `todos`: a importação, depois de gravar os valores da nota no item (a análise automática roda com o item completo).
 */
export async function recalcularMetricasEntrada(trx: AnyDB, codnf: number, somente: 'pendentes' | 'todos'): Promise<number> {
  const nf = (await trx.selectFrom('nf').select(['tipo', 'cfop', 'idempresa', 'nf_importacao_nfe', 'totalprod']).where('codnf', '=', codnf).executeTakeFirst()) as
    Record<string, unknown> | undefined;
  if (!nf || String(nf.tipo) !== 'E') return 0;
  const emp = Number(nf.idempresa ?? currentTenant().empresaId ?? 0);
  const empresa = ((await trx.selectFrom('empresas').select(['classfiscal', 'despfederativas', 'despoperacional', 'alqsimplesnac', 'imprenda', 'contsocial', 'uf'])
    .where('idempresa', '=', emp).executeTakeFirst()) ?? {}) as EmpresaCusto;
  const ctxCfg = { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' };
  const aproveitamento = String((await configNaTrx(trx, 'APROVEITAMENTO_CREDITO_ICMSST_NF', ctxCfg)) ?? 'N').toUpperCase() === 'S';
  const tipoPrec = String((await configNaTrx(trx, 'TIPO_PRECIFICACAO', ctxCfg)) ?? 'P').toUpperCase();
  const modoMargem = String((await configNaTrx(trx, 'MARGEM_PRECO_FINAL_OU_LIQUIDO', ctxCfg)) ?? 'F').toUpperCase() === 'F' ? 'final' : 'liquido';
  const itens = (await trx.selectFrom('nf_prod').selectAll().where('codnf', '=', codnf).orderBy('codnfprod').execute()) as Array<Record<string, unknown>>;
  const umItem = String(nf.nf_importacao_nfe ?? '') === 'S' && itens.length === 1 ? n(nf.totalprod) : null;
  const sn = String(empresa.classfiscal ?? '').trim().toUpperCase() === 'SN';
  const tributosDe = new Map<number, { pis: number; cofins: number; icmsEfetivo: number }>();
  let gravados = 0;
  for (const it of itens) {
    const indexador = Number(it.indexadortrib ?? 0);
    const aliqInterna = indexador > 0
      ? n(((await trx.selectFrom('indexador_tributario').select('aliquota_dest').where('codindexadortributario', '=', indexador).executeTakeFirst()) as { aliquota_dest?: unknown } | undefined)?.aliquota_dest) || n(it.icms_st_aliq_nota)
      : n(it.icms_st_aliq_nota);
    const c = custoDoItemNaEntrada(it, empresa, { cfopNota: nf.cfop, aproveitamentoCreditoIcmsSt: aproveitamento, totalProdNotaUmItem: umItem, aliqInternaIndexador: aliqInterna });
    const set: Record<string, unknown> = { vrbasecalculoicm_calc: arred(c.tempbaseicme, 4), vricm_calc: c.vricmCalc };
    const pendente = somente === 'todos' || n(it.custo_real_unit) === 0;
    if (pendente && c.qtdetotal > 0) {
      // o preço sugerido: TMargemPreco(empresa, produto, custo real; reposição em D/M).CalculaValorVenda(MARKUP) — uDMNF.pas:3898-3921
      const idp = Number(it.codproduto);
      if (!tributosDe.has(idp)) {
        const p = (await trx.selectFrom('produtos as pr').leftJoin('piscofins as pc', 'pc.idpiscofins', 'pr.idpiscofins')
          .select(['pr.aliquota', 'pc.aliq_pis_sai', 'pc.aliq_cofins_sai']).where('pr.idproduto', '=', idp).executeTakeFirst()) as Record<string, unknown> | undefined;
        const tributado = String(p?.aliquota ?? '').toUpperCase().startsWith('T');
        const al = tributado ? ((await trx.selectFrom('det_aliquota').select('icm_efetivo').where('aliquota', '=', String(p?.aliquota ?? '')).where('uf', '=', String(empresa.uf ?? ''))
          .executeTakeFirst()) as { icm_efetivo?: unknown } | undefined) : undefined;
        tributosDe.set(idp, { pis: n(p?.aliq_pis_sai), cofins: n(p?.aliq_cofins_sai), icmsEfetivo: tributado ? n(al?.icm_efetivo) : 0 });
      }
      const t = tributosDe.get(idp)!;
      const base = tipoPrec === 'D' || tipoPrec === 'M' ? c.tempvrcustorep : c.tempvrcusto;
      const markup = n(it.markup);
      let vrvendasug = 0;
      try {
        if (tipoPrec === 'D') vrvendasug = arred(base + (base * markup) / 100);
        else if (tipoPrec === 'M') vrvendasug = markup < 100 ? arred((base / (100 - markup)) * 100) : 0;
        else vrvendasug = arred(fiscal.precoAtual(base, markup, { pis: t.pis, cofins: t.cofins, icmsEfetivo: t.icmsEfetivo, fcp: 0, despOperacional: n(empresa.despoperacional),
          simplesNacional: sn, modoMargem, irpj: n(empresa.imprenda), csll: n(empresa.contsocial) } as never));
      } catch {
        vrvendasug = 0;
      }
      const m = margemDoItem(it, c.tempvrcusto, empresa);
      Object.assign(set, {
        ...(c.tempvrcusto > 0 ? { custo_real_unit: c.tempvrcusto } : {}),
        vrcustorep: c.tempvrcustorep, vrcustocsi: arred(c.tempvrcustocsi, 4), pmz: arred(c.temppmz), vrvendasug, vrajcustodec47530: c.tempvrajcusto47530,
        debitoicm: m.debitoicm, debitopiscofins: m.debitopiscofins, vendaliq: m.vendaliq, lucrobrutov: m.lucrobrutov, lucrobrutop: m.lucrobrutop, despopv: m.despopv,
        lucroliqv: m.lucroliqv, lucroliqp: m.lucroliqp, imprend: m.imprend, contsocial: m.contsocial, margeml2v: m.margeml2v, markupl2: m.markupl2,
      });
      gravados++;
    }
    await trx.updateTable('nf_prod').set(set).where('codnfprod', '=', Number(it.codnfprod)).execute();
  }
  return gravados;
}
