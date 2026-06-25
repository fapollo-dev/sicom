import { Body, Controller, Post } from '@nestjs/common';
import {
  calcularVendaSchema,
  calcularMargemSchema,
  calcularFiscalSchema,
  precificarProdutoSchema,
  type CalcularVendaDto,
  type CalcularMargemDto,
  type CalcularFiscalDto,
  type PrecificarProdutoDto,
} from '@apollo/shared';
import { PrecoService } from './preco.service';
import { FiscalPricingService } from './preco-fiscal.service';
import { PrecificacaoProdutoService } from './precificacao-produto.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** Endpoints de cálculo — regra nos services (legado reusado + reforma). */
@Controller('precificacao')
export class PrecificacaoController {
  constructor(
    private readonly preco: PrecoService,
    private readonly fiscal: FiscalPricingService,
    private readonly produto: PrecificacaoProdutoService,
  ) {}

  @Post('calcular-venda')
  calcularVenda(@Body(new ZodValidationPipe(calcularVendaSchema)) dto: CalcularVendaDto) {
    return { valorVenda: this.preco.calcularValorVenda(dto.custo, dto.margem, dto.modo) };
  }

  @Post('calcular-margem')
  calcularMargem(@Body(new ZodValidationPipe(calcularMargemSchema)) dto: CalcularMargemDto) {
    return { margem: this.preco.calcularMargem(dto.venda, dto.custo, dto.modo) };
  }

  /** Preço com impostos, parametrizável por regime (atual/reforma/transição). */
  @Post('calcular-fiscal')
  calcularFiscal(@Body(new ZodValidationPipe(calcularFiscalSchema)) dto: CalcularFiscalDto) {
    return { valorVenda: this.fiscal.calcular(dto.custo, dto.margem, dto.tabela as any) };
  }

  /** Precifica um produto reusando a regra do legado (aliquota/UF) + regime da Reforma. */
  @Post('produto')
  precificarProduto(@Body(new ZodValidationPipe(precificarProdutoSchema)) dto: PrecificarProdutoDto) {
    return this.produto.precificar(dto);
  }
}
