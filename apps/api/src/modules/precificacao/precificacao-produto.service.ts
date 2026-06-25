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
  modoMargem?: 'final' | 'liquido';
  regime: RegimeTributario;
  dataRef?: string; // para resolver a vigência da Reforma (default: vigência mais recente)
}

export interface PrecificarProdutoResult {
  valorVenda: number;
  regime: RegimeTributario;
  cst: number; // do legado (00/20/40/60)
  icmEfetivo: number; // do legado (já com redução/ST)
  baseReduzida: boolean;
  fonte: string; // a LEI do legado e/ou a fonte da Reforma
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
      valorVenda = this.fiscal.precoAtual(i.custo, i.margem, atuais);
    } else {
      // 2) Camada NOVA: Reforma (IBS/CBS/IS) por UF/vigência.
      const ref = await this.trib.resolverReforma(i.uf, dataRef);
      const reforma = { ibs: ref.ibs, cbs: ref.cbs, impostoSeletivo: ref.impostoSeletivo };
      valorVenda =
        i.regime === 'reforma'
          ? this.fiscal.precoReforma(i.custo, i.margem, reforma)
          : this.fiscal.precoTransicao(i.custo, i.margem, atuais, reforma); // transição: legado + reforma
      fonte = `${fonte} | ${ref.fonte}`;
    }

    return {
      valorVenda,
      regime: i.regime,
      cst: det.cst,
      icmEfetivo: det.icmEfetivo,
      baseReduzida: det.cst === 20 || det.base < 100,
      fonte,
    };
  }
}
