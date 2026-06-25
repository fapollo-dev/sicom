import { Injectable } from '@nestjs/common';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * Precificação COM IMPOSTOS — risco-coroa. Estende a regra de TMargemPreco (ramo fiscal,
 * "preço por dentro") e adiciona a **Reforma Tributária** (EC 132/2023): IBS+CBS+IS,
 * que são calculados **"por fora"** (sobre a base), e o período de **transição** (2026+)
 * em que os dois regimes coexistem.
 *
 * Princípio (ADR-010 / business-rule-extraction.md): alíquotas NÃO são magic numbers —
 * entram como TabelaTributaria parametrizável, com **vigência** e **fonte** registradas,
 * para atualizar sem redeploy quando a lei mudar (e ela muda várias vezes ao ano).
 */
export type RegimeTributario = 'atual' | 'reforma' | 'transicao';

/** Regime ATUAL (ICMS "por dentro" + PIS/COFINS + FCP + desp. operacional [+ IRPJ/CSLL]). */
export interface TributosAtuais {
  icmsEfetivo: number; // % (DET_ALIQUOTA.ICM_EFETIVO por aliquota+UF)
  fcp: number; // % Fundo de Combate à Pobreza
  pis: number; // % ALIQ_PIS_SAI
  cofins: number; // % ALIQ_COFINS_SAI
  despOperacional: number; // % EMPRESAS.DESPOPERACIONAL
  irpj?: number; // % (só no modo 'final')
  csll?: number; // % (só no modo 'final')
  simplesNacional?: boolean; // CLASSFISCAL='SN' → zera ICMS e FCP
  modoMargem?: 'final' | 'liquido'; // MARGEM_PRECO_FINAL_OU_LIQUIDO ('F' = final)
}

/** Regime da REFORMA (IBS estadual/municipal + CBS federal + IS seletivo), "por fora". */
export interface TributosReforma {
  ibs: number; // %
  cbs: number; // %
  impostoSeletivo?: number; // % (IS — "imposto do pecado")
}

/** Tabela tributária parametrizável (pinável por vigência/fonte). */
export interface TabelaTributaria {
  regime: RegimeTributario;
  vigenciaInicio: string; // ISO — fiscal versionável/pinável
  fonte: string; // ex.: 'LC 214/2025' / 'EC 132/2023' — magic number COM fonte
  atuais?: TributosAtuais;
  reforma?: TributosReforma;
}

@Injectable()
export class FiscalPricingService {
  private round2(v: number): number {
    return Math.round((v + Number.EPSILON) * 100) / 100;
  }

  /** Despacha pelo regime vigente. */
  calcular(custo: number, margem: number, tab: TabelaTributaria): number {
    if (custo <= 0) return 0;
    switch (tab.regime) {
      case 'atual':
        if (!tab.atuais) throw new BusinessRuleError('TRIBUTOS_ATUAIS_AUSENTES');
        return this.precoAtual(custo, margem, tab.atuais);
      case 'reforma':
        if (!tab.reforma) throw new BusinessRuleError('TRIBUTOS_REFORMA_AUSENTES');
        return this.precoReforma(custo, margem, tab.reforma);
      case 'transicao':
        if (!tab.atuais || !tab.reforma) throw new BusinessRuleError('TRIBUTOS_TRANSICAO_INCOMPLETOS');
        return this.precoTransicao(custo, margem, tab.atuais, tab.reforma);
    }
  }

  /** Regime ATUAL — "preço por dentro" (gross-up), fiel ao legado TMargemPreco. */
  precoAtual(custo: number, margem: number, t: TributosAtuais): number {
    const aliqSaida = (t.simplesNacional ? 0 : t.icmsEfetivo + t.fcp) / 100; // fração
    const pis = t.pis / 100;
    const cofins = t.cofins / 100;
    const desp = t.despOperacional / 100;
    let fator: number;
    let custoCalc: number;

    if (t.modoMargem === 'final') {
      const irpj = (t.irpj ?? 0) / 100;
      const csll = (t.csll ?? 0) / 100;
      fator =
        1 - (pis + cofins + aliqSaida + desp) -
        irpj + (aliqSaida + desp) * irpj -
        csll + (aliqSaida + desp) * csll;
      fator *= 100;
      custoCalc = (custo - irpj * custo - csll * custo) * 100;
    } else {
      fator = (1 - (pis + cofins + aliqSaida + desp)) * 100;
      custoCalc = custo * 100;
    }

    // diferença absoluta fator×margem (fiel ao legado)
    const denom = fator > margem ? fator - margem : margem - fator;
    if (denom === 0) throw new BusinessRuleError('MARGEM_INVALIDA', { margem });
    return this.round2(custoCalc / denom);
  }

  /** Regime REFORMA — IBS+CBS(+IS) "por fora": preço-base (custo+margem) + impostos sobre a base. */
  precoReforma(custo: number, margem: number, t: TributosReforma): number {
    const base = custo * (1 + margem / 100);
    const imp = (t.ibs + t.cbs + (t.impostoSeletivo ?? 0)) / 100;
    return this.round2(base * (1 + imp));
  }

  /**
   * ICMS-ST (Substituição Tributária) — regra clássica reusando o MVA do legado:
   *   baseST = valor·(1 + MVA/100) ; ICMS-ST = baseST·alíqDest − ICMS próprio(origem).
   * DESENVOLVIDO: sob a **Reforma** a ST é EXTINTA (IBS/CBS são não-cumulativos) → 0.
   */
  calcularIcmsSt(
    valorProduto: number,
    p: { aliquotaDest: number; icmFonte: number; mva: number },
    regime: RegimeTributario,
  ): { icmsSt: number; baseSt: number; aplicavel: boolean } {
    if (regime === 'reforma') {
      return { icmsSt: 0, baseSt: 0, aplicavel: false }; // ST não existe mais na Reforma
    }
    const icmsProprio = valorProduto * (p.icmFonte / 100);
    const baseSt = valorProduto * (1 + p.mva / 100);
    const icmsSt = baseSt * (p.aliquotaDest / 100) - icmsProprio;
    return { icmsSt: this.round2(Math.max(icmsSt, 0)), baseSt: this.round2(baseSt), aplicavel: true };
  }

  /** TRANSIÇÃO (2026+) — regime atual vigente + acréscimo "por fora" do IBS/CBS de transição. */
  precoTransicao(custo: number, margem: number, atuais: TributosAtuais, reforma: TributosReforma): number {
    const precoAtual = this.precoAtual(custo, margem, atuais);
    const novo = (reforma.ibs + reforma.cbs + (reforma.impostoSeletivo ?? 0)) / 100;
    return this.round2(precoAtual * (1 + novo));
  }
}
