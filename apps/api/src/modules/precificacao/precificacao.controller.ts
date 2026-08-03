import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  calcularVendaSchema,
  calcularMargemSchema,
  calcularFiscalSchema,
  precificarProdutoSchema,
  calcularPrecificacaoSchema,
  salvarPrecificacaoSchema,
  type CalcularVendaDto,
  type CalcularMargemDto,
  type CalcularFiscalDto,
  type PrecificarProdutoDto,
  type CalcularPrecificacaoDto,
  type SalvarPrecificacaoDto,
} from '@apollo/shared';
import { PrecoService } from './preco.service';
import { FiscalPricingService } from './preco-fiscal.service';
import { PrecificacaoProdutoService } from './precificacao-produto.service';
import { PrecificacaoCustoService } from './precificacao-custo.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** Endpoints de cálculo — regra nos services (legado reusado + reforma). */
@Controller('precificacao')
export class PrecificacaoController {
  constructor(
    private readonly preco: PrecoService,
    private readonly fiscal: FiscalPricingService,
    private readonly produto: PrecificacaoProdutoService,
    private readonly custo: PrecificacaoCustoService,
  ) {}

  // ===== PRECIFICAÇÃO DE MERCADORIAS (FRMPRIFICACAOCUSTO) — painel por produto × empresa =====
  /** abre o painel: produto + preço da empresa + empresas do operador + painel calculado. */
  @Get('custo/:idproduto')
  @UseGuards(AcessoGuard)
  @RequerAcesso('FRMPRIFICACAOCUSTO', 'BTNGRAVAR')
  abrirCusto(@Param('idproduto', ParseIntPipe) idproduto: number, @Query('idempresa') idempresa?: string) {
    return this.custo.abrir(idproduto, idempresa ? Number(idempresa) : undefined);
  }

  /** recomputa o painel (PURO — não grava). */
  @Post('custo/calcular')
  @HttpCode(200)
  @UseGuards(AcessoGuard)
  @RequerAcesso('FRMPRIFICACAOCUSTO', 'BTNGRAVAR')
  calcularCusto(@Body(new ZodValidationPipe(calcularPrecificacaoSchema)) dto: CalcularPrecificacaoDto) {
    return this.custo.calcular(dto);
  }

  /** grava o painel nas empresas selecionadas (+ grupo de preço + auditoria); modoLote enfileira e reverte o preço. */
  @Post('custo/salvar')
  @HttpCode(200)
  @UseGuards(AcessoGuard)
  @RequerAcesso('FRMPRIFICACAOCUSTO', 'BTNGRAVAR')
  salvarCusto(@Body(new ZodValidationPipe(salvarPrecificacaoSchema)) dto: SalvarPrecificacaoDto) {
    return this.custo.salvar(dto);
  }

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
