import { Injectable } from '@nestjs/common';
import { TributacaoRepository } from './tributacao.repository';
import { FiscalPricingService, type RegimeTributario } from './preco-fiscal.service';

export interface PrecificarProdutoInput {
  custo: number;
  margem: number;
  aliquota: string; // código fiscal do produto (ex.: T01, T56, STB) — regra do legado
  uf: string;
  pis: number;
  cofins: number;
  despOperacional?: number;
  fcp?: number; // % FCP saída (PMZ/margem)
  irpj?: number; // % IR sobre o lucro (margem líquida)
  csll?: number; // % CSLL sobre o lucro (margem líquida)
  modoMargem?: 'final' | 'liquido';
  regime: RegimeTributario;
  dataRef?: string; // para resolver a vigência da Reforma (default: vigência mais recente)
  // componentes do CUSTO LÍQUIDO (default 0 → custo líquido = custo); a derivação da NF é adiada.
  st?: number;
  ipi?: number;
  frete?: number;
  seguro?: number;
  despac?: number;
  creditoPis?: number;
  creditoIcms?: number;
}

export interface PrecificarProdutoResult {
  valorVenda: number;
  regime: RegimeTributario;
  cst: number; // do legado (00/20/40/60)
  icmEfetivo: number; // do legado (já com redução/ST)
  baseReduzida: boolean;
  fonte: string; // a LEI do legado e/ou a fonte da Reforma
  // motor completo (corte precificação): custo líquido + PMZ + cadeia de lucro/margem líquida.
  custoLiquido: number;
  pmz: number;
  lucroBruto: number;
  lucroLiquido: number;
  margemLiquida: number; // %
}

/**
 * Precificação de produto: REUSA a regra fiscal do legado (DET_ALIQUOTA via
 * TributacaoRepository — que já traz ST/redução/isenção/CST/LEI) e DESENVOLVE a
 * camada da Reforma por cima. O preço sai do FiscalPricingService; este service
 * faz a orquestração (resolver tributos → precificar), expondo CST e a fonte legal.
 */
@Injectable()
export class PrecificacaoProdutoService {
  constructor(
    private readonly trib: TributacaoRepository,
    private readonly fiscal: FiscalPricingService,
  ) {}

  async precificar(i: PrecificarProdutoInput): Promise<PrecificarProdutoResult> {
    // 1) Regra LEGADA: resolve ICMS efetivo / CST / redução / LEI por (aliquota, UF).
    const det = await this.trib.resolverAtual(i.aliquota, i.uf);
    const semIcmsSaida = det.icmEfetivo <= 0; // SN/isento/ST/NTB — sem ICMS de saída → sem FCP

    // CUSTO LÍQUIDO é a BASE do preço (uMargemPreco.pas:1318-1321: markup/margem incidem sobre VRCUSTOLIQUIDO,
    // NÃO sobre o custo bruto). Sem componentes → custo líquido = custo (retrocompat: mesmo valorVenda de antes).
    const custoLiq = this.fiscal.custoLiquido(i.custo, {
      st: i.st, ipi: i.ipi, frete: i.frete, seguro: i.seguro, despac: i.despac, creditoPis: i.creditoPis, creditoIcms: i.creditoIcms,
    });

    const atuais = {
      icmsEfetivo: det.icmEfetivo, // já encapsula ST(=0)/redução/isento — não reinventamos
      fcp: 0,
      pis: i.pis,
      cofins: i.cofins,
      despOperacional: i.despOperacional ?? 0,
      modoMargem: i.modoMargem ?? ('liquido' as const),
    };
    const dataRef = i.dataRef ?? '9999-12-31';

    let valorVenda: number;
    let fonte = det.lei ?? det.descricao ?? `CST ${det.cst}`;

    if (i.regime === 'atual') {
      valorVenda = this.fiscal.precoAtual(custoLiq, i.margem, atuais);
    } else {
      // 2) Camada NOVA: Reforma (IBS/CBS/IS) por UF/vigência.
      const ref = await this.trib.resolverReforma(i.uf, dataRef);
      const reforma = { ibs: ref.ibs, cbs: ref.cbs, impostoSeletivo: ref.impostoSeletivo };
      valorVenda =
        i.regime === 'reforma'
          ? this.fiscal.precoReforma(custoLiq, i.margem, reforma)
          : this.fiscal.precoTransicao(custoLiq, i.margem, atuais, reforma); // transição: legado + reforma
      fonte = `${fonte} | ${ref.fonte}`;
    }

    // Motor completo: PMZ + cadeia de lucro/margem líquida sobre o custo líquido. As "saídas" (ICMS) usam o
    // icmEfetivo do legado (já com redução/ST/isenção); SN/isento zera ICMS/FCP.
    const icmsSaida = det.icmEfetivo;
    const fcp = semIcmsSaida ? 0 : (i.fcp ?? 0);
    const despOp = i.despOperacional ?? 0;
    // PMZ TOLERANTE: saídas ≥ 100% (não-precificável) NÃO derruba o valorVenda (fiel ao legado, que exibe a
    // venda mesmo com PMZ absurdo, uPrecificacaoProdutos.pas:1333 sem validação). O método puro `pmz` lança
    // (contrato dos testes/uso direto); aqui a orquestração degrada p/ pmz=0 e preserva o resto da resposta.
    let pmz = 0;
    try {
      pmz = this.fiscal.pmz(custoLiq, { pis: i.pis, cofins: i.cofins, icms: icmsSaida, fcp, despOperacional: despOp });
    } catch {
      pmz = 0;
    }
    const m = this.fiscal.margemLiquida(valorVenda, custoLiq, {
      pis: i.pis, cofins: i.cofins, icms: icmsSaida, fcp, despOperacional: despOp, irpj: i.irpj, csll: i.csll,
    });

    return {
      valorVenda,
      regime: i.regime,
      cst: det.cst,
      icmEfetivo: det.icmEfetivo,
      baseReduzida: det.cst === 20 || det.base < 100,
      fonte,
      custoLiquido: custoLiq,
      pmz,
      lucroBruto: m.lucroBruto,
      lucroLiquido: m.lucroLiquido,
      margemLiquida: m.margemLiquida,
    };
  }
}
