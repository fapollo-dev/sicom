/**
 * A ENTRADA DECOMPOSTA — o motor puro de `TDMNF.InsereProdutosDaDecomposicao` (udmNF.pas:10420-10860), sem banco.
 * Dossiê: docs/04-screen-dossier/dossiers/retaguarda/uNF-decomposicao-entrada.md (§3 e §4).
 *
 * O item-pai (produto com ENTRADA_DECOMPOSTA='S') sai da nota e cada filho do cadastro DECOMPOSICAO com PERCENTUAL > 0 entra no lugar,
 * na ordem de `P.DESCRICAO` (:10446-10451 — a ordem de inserção vale, porque o dataset não tem índice):
 *  - QUANTIDADE = round(QtdKG × PERC/100, 3) (:10573);
 *  - VRCUSTO "pelo valor de venda" (CALCULO_VALOR_CUSTO_DECOMP 'CV' ou NULL) = Tot × (Q×VV) / TV / Q, com TV = Σ round(QtdKG×PERC/100×VV, 2)
 *    (a quantidade NÃO arredondada, :10483-10508). O fonte arredonda a 4 casas (:10592-10598); o binário que roda arredonda a **6**
 *    (6.245 de 7.116 filhos de 2026 conferem a 6 casas, 38 a 4) — vale o dado;
 *  - VRCUSTO "rateado" ('CR') = round(Tot × PERC/100 / Q, 4) + a perda por kg, onde a perda = Σ PERC dos filhos de PERCENTUAL_PERDAS=100
 *    × Tot/100 / Σ (PERC×QtdKG/100) dos outros (:10509-10545, :10575-10591); o filho de perda total fica com 0,01 e ITEM_PERDA_TOTAL 'S';
 *    ARREDONDA vira 'N' quando VRCUSTO×Q passa de round(Tot×PERC/100, 4) + perda (:10582-10583). Só a NF 17650 (2021) usou o CR;
 *  - o AJUSTE (:10680-10791): a sobra de quantidade (QtdKG − Σ Q) e depois a de valor (Tot − Σ round(Q×VRCUSTO, 2)) vão para o
 *    PRIMEIRO filho que não é de perda total — `VRCUSTO := (VRCUSTO×Q ± |resto|)/Q`, gravado a 9 casas (NUMBER(18,9)). Na produção,
 *    319 de 319 ajustes de quantidade e 522 de 522 de custo caem no 1º alfabético, e NF.TOTALPROD = Σ round(Q×VRCUSTO,2) em 644 de 644.
 *    O fonte soma em variáveis locais não inicializadas (:9944/:9947); o dado mostra que partem de zero;
 *  - o ICMS-ST do pai é RATEADO pelo TOTALPRODS dos filhos de CFOP de ST (:10793-10861): VRBASEST = TOTALPRODS × BaseST/Σ, idem o
 *    VRICMST, e VRBASE_STEXTERNO/STREAL iguais — sem ajuste de sobra (VRBASEST confere em 5.732 de 5.743 filhos com ST, ±0,01).
 */
import { BusinessRuleError } from '../../shared/errors/app-error';
import { arred } from './nf-custo-item';

/** `CFOPDeSubstituicaoTributaria` (udmNF.pas:9871-9899): a lista, e o 1949/2949 só com alíquota 'S…' (substituição) */
const CFOPS_ST = new Set([1403, 2403, 1401, 2401, 1406, 2406, 1407, 2407, 1411, 2411, 1902, 2902, 1910, 2910, 1923, 2923, 5403, 6403, 5411, 6411,
  5202, 6202, 1124]);
export const cfopDeSubstituicaoTributaria = (cfop: number, aliquota?: string | null): boolean =>
  CFOPS_ST.has(Number(cfop)) || ([1949, 2949].includes(Number(cfop)) && String(aliquota ?? '').startsWith('S'));

const trunca = (x: number, casas = 2): number => {
  const m = 10 ** casas;
  return (Math.floor(Math.abs(x) * m + 1e-9) / m) * (x < 0 ? -1 : 1);
};
/** o campo Currency do Delphi guarda 4 casas */
const cur = (x: number) => Math.round((x + Number.EPSILON) * 1e4) / 1e4;

export interface FilhoDoCadastro {
  idproduto: number;
  descricao: string;
  codbarra?: string | null;
  percentual: number;
  /** MULTI_PRECO.VRVENDA do filho na loja da nota (`cdsProdutos`) */
  vrvenda: number;
  /** PRODUTOS.PERCENTUAL_PERDAS do filho — só o rateio (CR) olha: 100 = item de perda total */
  percentualPerdas?: number | null;
  /** a alíquota do filho (o 1949/2949 só é de ST com alíquota 'S…') */
  aliquota?: string | null;
}

export interface EntradaDecomposicao {
  /** "Quantidade total em KG" do diálogo */
  qtdTotal: number;
  /** "Valor total" do diálogo */
  valorTotal: number;
  /** PRODUTOS.CALCULO_VALOR_CUSTO_DECOMP do pai: só 'CR' é rateio; qualquer outro valor (CV, NULL) é pelo valor de venda */
  calculoCusto: string | null | undefined;
  /** o CFOP digitado no diálogo (define se há rateio do ST) */
  cfop: number;
  /** VRBASEST e VRICMST do item-pai (o diálogo não edita) */
  baseSt: number;
  icmsSt: number;
  filhos: FilhoDoCadastro[];
}

export interface FilhoDecomposto {
  idproduto: number;
  descricao: string;
  codbarra: string | null;
  percentual: number;
  vrvenda: number;
  quantidade: number;
  vrcusto: number;
  item_perda_total: 'S' | 'N';
  arredonda: 'S' | 'N';
  vrbasest: number;
  vricmst: number;
}

/** a ordem do `ORDER BY P.DESCRICAO` (binária, como o Oracle da loja devolve: 'PE SUINO' antes de 'PERDA SUINA') */
const porDescricao = (a: FilhoDoCadastro, b: FilhoDoCadastro) => {
  const x = a.descricao ?? '';
  const y = b.descricao ?? '';
  return x < y ? -1 : x > y ? 1 : 0;
};

export function decomporItemEntrada(e: EntradaDecomposicao): FilhoDecomposto[] {
  const filhos = e.filhos.filter((f) => Number(f.percentual) > 0).slice().sort(porDescricao);
  if (!filhos.length) return [];
  const rateado = String(e.calculoCusto ?? '').trim().toUpperCase() === 'CR';
  const qt = Number(e.qtdTotal);
  const tot = Number(e.valorTotal);

  let totalVenda = 0;
  let valorUnPerda = 0;
  if (!rateado) {
    for (const f of filhos) {
      if (!(Number(f.vrvenda) > 0)) {
        const txt = `Produto "${f.codbarra ?? ''} - ${f.descricao}" com valor de venda zero. Verifique!`;
        throw new BusinessRuleError('NF_DECOMPOSICAO_VENDA_ZERO', { idproduto: f.idproduto }, txt);
      }
      totalVenda = cur(totalVenda + arred(((qt * f.percentual) / 100) * f.vrvenda, 2));
    }
  } else {
    let percPerda = 0;
    let qtdNaoPerda = 0;
    for (const f of filhos) {
      if (Number(f.percentualPerdas ?? 0) === 100) percPerda = cur(percPerda + f.percentual);
      else qtdNaoPerda = cur(qtdNaoPerda + cur((f.percentual * qt) / 100));
    }
    const valorPerda = cur((percPerda * tot) / 100);
    if (valorPerda > 0 && qtdNaoPerda > 0) valorUnPerda = cur(arred(valorPerda / qtdNaoPerda, 4));
  }

  const out: FilhoDecomposto[] = filhos.map((f) => {
    const q = arred((qt * f.percentual) / 100, 3);
    let vrcusto = 0;
    let arredonda: 'S' | 'N' = 'S';
    let perda: 'S' | 'N' = 'N';
    if (rateado) {
      vrcusto = q > 0 ? arred((tot * f.percentual) / 100 / q, 4) + valorUnPerda : 0;
      if (vrcusto * q > arred((tot * f.percentual) / 100, 4) + valorUnPerda) arredonda = 'N';
      if (Number(f.percentualPerdas ?? 0) === 100) {
        vrcusto = 0.01;
        perda = 'S';
      }
    } else if (q > 0 && totalVenda > 0) {
      vrcusto = arred((tot * (q * f.vrvenda)) / totalVenda / q, 6);
    }
    return {
      idproduto: f.idproduto, descricao: f.descricao, codbarra: f.codbarra ?? null, percentual: f.percentual, vrvenda: f.vrvenda,
      quantidade: q, vrcusto, item_perda_total: perda, arredonda, vrbasest: 0, vricmst: 0,
    };
  });

  // o ajuste de quantidade e, com a quantidade já ajustada, o de valor — no 1º filho que não é de perda total
  const alvo = out.find((f) => f.item_perda_total !== 'S');
  const restoQtd = cur(qt - out.reduce((s, f) => cur(s + f.quantidade), 0));
  if (alvo && restoQtd !== 0) alvo.quantidade = arred(alvo.quantidade + restoQtd, 3);
  // VRTOTALPRODUTOS/TOTALPRODS (udmNF.pas:3996-3998, :4146-4149): arredonda com ARREDONDA 'S', trunca com 'N'
  const totalProd = (f: FilhoDecomposto) => (f.arredonda === 'S' ? arred(f.quantidade * f.vrcusto, 2) : trunca(f.quantidade * f.vrcusto, 2));
  const restoValor = cur(tot - out.reduce((s, f) => cur(s + totalProd(f)), 0));
  if (alvo && restoValor !== 0 && alvo.quantidade > 0) alvo.vrcusto = arred((alvo.vrcusto * alvo.quantidade + restoValor) / alvo.quantidade, 9);

  // o rateio do ST do pai pelo TOTALPRODS (todos os filhos têm o CFOP do diálogo neste ponto)
  const aliq = new Map(filhos.map((f) => [f.idproduto, f.aliquota ?? null]));
  const deSt = out.filter((f) => cfopDeSubstituicaoTributaria(e.cfop, aliq.get(f.idproduto)));
  if (deSt.length && Number(e.baseSt) > 0) {
    const totalSt = deSt.reduce((s, f) => cur(s + totalProd(f)), 0);
    if (totalSt > 0) {
      const constBase = (Number(e.baseSt) / totalSt) * 100;
      const constIcms = (Number(e.icmsSt) / totalSt) * 100;
      for (const f of deSt) {
        f.vrbasest = arred((totalProd(f) * constBase) / 100, 2);
        f.vricmst = arred((totalProd(f) * constIcms) / 100, 2);
      }
    }
  }
  return out;
}
