import { Injectable } from '@nestjs/common';
import { BusinessRuleError } from '../../shared/errors/app-error';

/** Modo de precificação (legado: config TIPO_PRECIFICACAO). */
export type ModoPrecificacao = 'D' | 'M';

/**
 * Regra de negócio extraída de `TMargemPreco` (uMargemPreco.pas) — a PRIMEIRA
 * regra de cálculo migrada (≠ CRUD). Fiel ao legado, incluindo as duas pegadinhas:
 *  - markup sobre CUSTO (modo 'D') vs margem sobre VENDA (modo 'M') — fórmulas distintas;
 *  - guardas de divisão por zero (custo>0; (100-margem)≠0; venda>0).
 * A regra vive no SERVICE (não no controller, não na SQL) — seção 02 / business-rule-extraction.md.
 *
 * Nota monetária: o legado usa Real/Currency; aqui retornamos number e arredondamos
 * só na borda (round2). Para persistência fiscal, migrar para decimal (ADR/seção 02).
 */
@Injectable()
export class PrecoService {
  /** Arredondamento comercial half-up a 2 casas (aplicado na borda, não no meio). */
  private round2(v: number): number {
    return Math.round((v + Number.EPSILON) * 100) / 100;
  }

  /**
   * Margem a partir de venda e custo (espelha `CalculaMargemPelaVenda`).
   * Modo 'D': markup sobre custo = (100·venda/custo) − 100  (precisa custo>0).
   * Modo 'M': margem sobre venda = 100 − (custo/venda)·100   (precisa venda>0).
   */
  calcularMargem(valorVenda: number, valorCusto: number, modo: ModoPrecificacao): number {
    if (modo === 'D') {
      if (valorCusto <= 0) return 0; // guarda do legado
      return this.round2(((100 * valorVenda) / valorCusto) - 100);
    }
    // modo 'M'
    if (valorVenda <= 0) return 0; // guarda do legado
    return this.round2(100 - (valorCusto / valorVenda) * 100);
  }

  /**
   * Valor de venda a partir de custo e margem (espelha `CalculaValorVenda`, modos D/M).
   * Modo 'D': venda = custo + custo·margem/100.
   * Modo 'M': venda = (custo/(100−margem))·100  (precisa (100−margem)≠0).
   * (O ramo fiscal — alíquotas/PIS/COFINS/FCP — é a extensão seguinte; exige dados fiscais.)
   */
  calcularValorVenda(valorCusto: number, margem: number, modo: ModoPrecificacao): number {
    if (valorCusto <= 0) return 0; // guarda comum do legado
    if (modo === 'D') {
      return this.round2(valorCusto + (valorCusto * margem) / 100);
    }
    // modo 'M'
    if (100 - margem === 0) {
      throw new BusinessRuleError('MARGEM_INVALIDA', { margem }); // divisão por zero
    }
    return this.round2((valorCusto / (100 - margem)) * 100);
  }
}
