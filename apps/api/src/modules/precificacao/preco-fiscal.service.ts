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

  /** arredonda a `d` casas (espelha o `RoundTo(x, -d)` do legado — ex.: MVA ajustado a 3 casas). */
  private roundTo(v: number, d: number): number {
    const f = Math.pow(10, d);
    return Math.round((v + Number.EPSILON) * f) / f;
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
   * ICMS-ST (Substituição Tributária) — porta fiel do `TIndexadorTributario` (uIndexadorTributario.pas),
   * caminho **Lucro Real** (débito − crédito). Parâmetros opcionais com default **no-op** → reduz à
   * fórmula clássica (caller do Produto e teste STB intactos). DESENVOLVIDO: sob a **Reforma** a ST é
   * EXTINTA (IBS/CBS não-cumulativos) → 0.
   *
   * Fórmulas (uIndexadorTributario.pas):
   *  - MVA ajustado interestadual (só interestadual e fornecedor não-SN): `GetMVAAjustado:259-285`
   *      mvaAj = ((1+MVA/100)·(1−AliqFonte/100)/(1−(AliqDest−FEM)/100) − 1)·100, RoundTo 3 casas.
   *  - BC-ST reduzida (REDCOM): `VrBCSTReduzida:308` = (valor−desconto)·REDCOM/100.
   *  - baseST = bcReduzida·(1+mvaAj/100); crédito = (valor−desconto)·ReducaoAliqFonte/100·AliqFonte/100;
   *    débito = baseST·AliqDest/100; **ST = débito − crédito** (LR), clamp ≥ 0.
   */
  calcularIcmsSt(
    valorProduto: number,
    p: {
      aliquotaDest: number;
      icmFonte: number;
      mva: number;
      redcom?: number; // % da BC-ST (100 = sem redução)
      reducaoAliqFonte?: number; // % de redução da alíquota-fonte no crédito (100 = sem)
      aliquotaFem?: number; // FEM (entra no denominador do MVA ajustado)
      interstate?: boolean; // UF origem ≠ destino → MVA ajustado
      fornecedorSn?: boolean; // fornecedor Simples → não ajusta MVA
      desconto?: number; // desconto deduzido da base e do crédito
    },
    regime: RegimeTributario,
  ): { icmsSt: number; baseSt: number; mvaEfetivo: number; aplicavel: boolean } {
    if (regime === 'reforma') {
      return { icmsSt: 0, baseSt: 0, mvaEfetivo: 0, aplicavel: false }; // ST não existe mais na Reforma
    }
    // cadastro usa 100 p/ "sem redução"; valor ≤ 0 também trata como 100 (não zerar a base).
    const redcom = p.redcom != null && p.redcom > 0 ? p.redcom : 100;
    const reducaoFonte = p.reducaoAliqFonte != null && p.reducaoAliqFonte > 0 ? p.reducaoAliqFonte : 100;
    const fem = p.aliquotaFem ?? 0;
    const desconto = p.desconto ?? 0;

    // MVA ajustado interestadual (preserva (AliqDest − FEM) no denominador e RoundTo 3 casas).
    let mvaEfetivo = p.mva;
    if (p.interstate && !p.fornecedorSn) {
      const denom = 1 - (p.aliquotaDest - fem) / 100;
      if (denom !== 0) {
        mvaEfetivo = this.roundTo(((1 + p.mva / 100) * (1 - p.icmFonte / 100) / denom - 1) * 100, 3);
      }
    }

    const valorBase = valorProduto - desconto;
    const bcReduzida = valorBase * (redcom / 100);
    const baseSt = bcReduzida * (1 + mvaEfetivo / 100);
    const credito = valorBase * (reducaoFonte / 100) * (p.icmFonte / 100); // crédito a deduzir (LR)
    const debito = baseSt * (p.aliquotaDest / 100);
    const icmsSt = Math.max(debito - credito, 0);
    return { icmsSt: this.round2(icmsSt), baseSt: this.round2(baseSt), mvaEfetivo, aplicavel: true };
  }

  /** TRANSIÇÃO (2026+) — regime atual vigente + acréscimo "por fora" do IBS/CBS de transição. */
  precoTransicao(custo: number, margem: number, atuais: TributosAtuais, reforma: TributosReforma): number {
    const precoAtual = this.precoAtual(custo, margem, atuais);
    const novo = (reforma.ibs + reforma.cbs + (reforma.impostoSeletivo ?? 0)) / 100;
    return this.round2(precoAtual * (1 + novo));
  }
}
