import { XMLParser } from 'fast-xml-parser';
import { chaveNfeValida } from '@apollo/shared';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * Parser do XML da NFe 4.00 (import de recebimento). Extrai APENAS o que o mapa XML→NF/NF_PROD precisa
 * (ide/emit/det[]/prod/imposto/total) — os valores fiscais em R$ são a VERDADE do fornecedor (não recalculamos).
 * Usa fast-xml-parser: `removeNSPrefix` (nfe:/ds:), `ignoreAttributes:false` (Id do infNFe, nItem do det),
 * `parseTagValue:false` (mantém códigos com zero à esquerda como string; convertemos números aqui), e
 * `isArray:det` (1 item também vira array — o bug clássico do parse manual). O bloco <Signature> é ignorado.
 */

export interface NfeItemParsed {
  nItem: number;
  cProd: string;
  cEAN: string; // pode ser '' ou 'SEM GTIN'
  xProd: string;
  ncm?: string;
  cest?: string;
  cfopXml: string; // CFOP do fornecedor (cru); a entrada ajusta 5→1/6→2
  uCom?: string;
  qCom: number;
  vUnCom: number;
  vProd: number;
  vDesc: number;
  origem?: string; // ICMS orig (CST-origem)
  cst?: string; // CST (regime normal)
  csosn?: string; // CSOSN (Simples)
  vBC: number;
  pICMS: number;
  vICMS: number;
  vBCST: number;
  vICMSST: number;
  pMVAST: number;
  pIPI: number;
  vIPI: number;
  cstPisCofins?: string;
  pPIS: number;
  pCOFINS: number;
}

/** duplicata do XML (`<cobr><dup>`) → 1 título A Pagar (corte-4). dVenc é 'YYYY-MM-DD' (date-only, sem fuso). */
export interface NfeDuplicataParsed {
  nDup: string; // número da duplicata do fornecedor
  dVenc: string; // 'YYYY-MM-DD'
  vDup: number; // valor da parcela
}

export interface NfeParsed {
  chave: string; // 44 dígitos (Id sem 'NFe')
  nNF: string;
  serie: string;
  modelo: number;
  dhEmiISO: string; // 'YYYY-MM-DD'
  tpNF: string; // '0' entrada / '1' saída (visão do EMITENTE)
  finNFe: string; // '1' normal / '2' complementar / '3' ajuste / '4' devolução
  tpAmb: string; // '1' produção / '2' homologação
  emitCnpj: string; // só dígitos
  emitNome?: string;
  protocolo?: string;
  total: {
    vNF: number; vProd: number; vICMS: number; vBC: number; vIPI: number;
    vST: number; vDesc: number; vFrete: number; vSeg: number; vOutro: number; vBCST: number;
  };
  itens: NfeItemParsed[];
  duplicatas: NfeDuplicataParsed[]; // <cobr><dup> — vazio quando à vista (sem <cobr>)
}

const num = (v: unknown): number => {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v).trim());
/** primeiro filho de um grupo de escolha (ICMS→ICMS00/ICMS10/ICMSSN…, PIS→PISAliq/PISNT…). */
const primeiro = (grupo: unknown): Record<string, unknown> => {
  if (!grupo || typeof grupo !== 'object') return {};
  const vals = Object.values(grupo as Record<string, unknown>).filter((v) => v && typeof v === 'object');
  return (vals[0] as Record<string, unknown>) ?? {};
};

export function parseNfeXml(xml: string): NfeParsed {
  if (!xml || typeof xml !== 'string' || xml.trim() === '') throw new BusinessRuleError('NFE_XML_INVALIDO');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
    processEntities: false, // defesa-em-profundidade: NFe não tem DTD/entidades — desliga qualquer expansão
    isArray: (name) => name === 'det' || name === 'dup', // dup repete em <cobr>; força array mesmo com 1
  });
  let root: any;
  try {
    root = parser.parse(xml);
  } catch {
    throw new BusinessRuleError('NFE_XML_INVALIDO');
  }
  const nfe = root?.nfeProc?.NFe ?? root?.NFe; // autorizado (nfeProc) ou NFe nua
  const inf = nfe?.infNFe;
  if (!inf) throw new BusinessRuleError('NFE_XML_INVALIDO');

  const chave = str(inf['@_Id']).replace(/^NFe/i, '').replace(/\D/g, '');
  if (chave.length !== 44 || !chaveNfeValida(chave)) throw new BusinessRuleError('NF_CHAVE_INVALIDA');

  const ide = inf.ide ?? {};
  const emit = inf.emit ?? {};
  const tot = inf.total?.ICMSTot ?? {};
  const prot = root?.nfeProc?.protNFe?.infProt ?? {};
  const dets: any[] = Array.isArray(inf.det) ? inf.det : inf.det ? [inf.det] : [];
  if (!dets.length) throw new BusinessRuleError('NF_SEM_ITENS');

  const dh = str(ide.dhEmi || ide.dEmi);
  const itens: NfeItemParsed[] = dets.map((d, i) => {
    const prod = d?.prod ?? {};
    const imp = d?.imposto ?? {};
    const icms = primeiro(imp.ICMS);
    const ipi = imp.IPI?.IPITrib ?? {};
    const pis = primeiro(imp.PIS);
    const cof = primeiro(imp.COFINS);
    const cst = str(icms.CST) || undefined;
    const csosn = str(icms.CSOSN) || undefined;
    return {
      nItem: Number(str(d['@_nItem'])) || i + 1,
      cProd: str(prod.cProd),
      cEAN: str(prod.cEAN),
      xProd: str(prod.xProd),
      ncm: str(prod.NCM) || undefined,
      cest: str(prod.CEST) || undefined,
      cfopXml: str(prod.CFOP),
      uCom: str(prod.uCom) || undefined,
      qCom: num(prod.qCom),
      vUnCom: num(prod.vUnCom),
      vProd: num(prod.vProd),
      vDesc: num(prod.vDesc),
      origem: str(icms.orig) || undefined,
      cst,
      csosn,
      vBC: num(icms.vBC),
      pICMS: num(icms.pICMS),
      vICMS: num(icms.vICMS),
      vBCST: num(icms.vBCST),
      vICMSST: num(icms.vICMSST),
      pMVAST: num(icms.pMVAST),
      pIPI: num(ipi.pIPI),
      vIPI: num(ipi.vIPI),
      cstPisCofins: str(pis.CST) || undefined,
      pPIS: num(pis.pPIS),
      pCOFINS: num(cof.pCOFINS),
    };
  });

  // NRONF/SÉRIE derivados da CHAVE (fiel a NFe.pas: Copy(chave,26,..)/(chave,23,3)) — sempre presentes
  // (a chave é 44 díg validados), o que torna a dedup por número confiável mesmo se ide/nNF vier vazio.
  // Layout (0-based): cUF[0..1] AAMM[2..5] CNPJ[6..19] mod[20..21] serie[22..24] nNF[25..33] tpEmis[34] cNF[35..42] DV[43].
  const serieChave = chave.slice(22, 25);
  const nnfChave = String(Number(chave.slice(25, 34)));

  // <cobr><dup> → duplicatas (1 por parcela). <cobr> é OPCIONAL (à vista omite) → duplicatas=[].
  const dups: any[] = Array.isArray(inf.cobr?.dup) ? inf.cobr.dup : inf.cobr?.dup ? [inf.cobr.dup] : [];
  const duplicatas: NfeDuplicataParsed[] = dups.map((d) => ({
    nDup: str(d.nDup),
    dVenc: str(d.dVenc).slice(0, 10), // date-only na NFe
    vDup: num(d.vDup),
  }));

  return {
    chave,
    nNF: nnfChave,
    serie: serieChave,
    modelo: Number(str(ide.mod)) || 55,
    dhEmiISO: dh ? dh.slice(0, 10) : '',
    tpNF: str(ide.tpNF),
    finNFe: str(ide.finNFe) || '1',
    tpAmb: str(ide.tpAmb) || '2',
    emitCnpj: str(emit.CNPJ).replace(/\D/g, ''),
    emitNome: str(emit.xNome) || undefined,
    protocolo: str(prot.nProt) || undefined,
    total: {
      vNF: num(tot.vNF),
      vProd: num(tot.vProd),
      vICMS: num(tot.vICMS),
      vBC: num(tot.vBC),
      vIPI: num(tot.vIPI),
      vST: num(tot.vST),
      vDesc: num(tot.vDesc),
      vFrete: num(tot.vFrete),
      vSeg: num(tot.vSeg),
      vOutro: num(tot.vOutro),
      vBCST: num(tot.vBCST),
    },
    itens,
    duplicatas,
  };
}
