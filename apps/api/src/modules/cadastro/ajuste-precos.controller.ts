import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { processarLotesSchema, excluirLotesSchema, atualizarLotePromoSchema, type ProcessarLotesDto, type ExcluirLotesDto, type AtualizarLotePromoDto } from '@apollo/shared';
import { AjustePrecosService } from './ajuste-precos.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * AJUSTE DE PREÇOS - LOTE (FRMAJUSTEPRECOS) — fila de lotes pendentes + processar (aplica em MULTI_PRECO) +
 * excluir (soft) + editar a promo do lote.
 */
@Controller('cadastro/ajuste-precos')
@UseGuards(AcessoGuard)
export class AjustePrecosController {
  constructor(private readonly svc: AjustePrecosService) {}

  /** fila de lotes pendentes da empresa (período + origem opcionais). */
  @Get('fila')
  @RequerAcesso('FRMAJUSTEPRECOS', 'BTNGRAVAR')
  fila(@Query('dtini') dtini?: string, @Query('dtfim') dtfim?: string, @Query('origem') origem?: 'CADASTRO' | 'PEDIDO' | 'DIVERGENTE') {
    return this.svc.fila(dtini, dtfim, origem);
  }

  /** processa os lotes selecionados → aplica em MULTI_PRECO (+ grupo de preço + histórico). */
  @Post('processar')
  @HttpCode(200)
  @RequerAcesso('FRMAJUSTEPRECOS', 'BTNGRAVAR')
  processar(@Body(new ZodValidationPipe(processarLotesSchema)) body: ProcessarLotesDto) {
    return this.svc.processar(body.ids);
  }

  /** exclui (soft) os lotes pendentes selecionados. */
  @Post('excluir')
  @HttpCode(200)
  @RequerAcesso('FRMAJUSTEPRECOS', 'BTNEXCLUIR')
  excluir(@Body(new ZodValidationPipe(excluirLotesSchema)) body: ExcluirLotesDto) {
    return this.svc.excluir(body.ids);
  }

  /** edita os campos de promo de um lote pendente. */
  @Put(':id/promo')
  @RequerAcesso('FRMAJUSTEPRECOS', 'BTNGRAVAR')
  atualizarPromo(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(atualizarLotePromoSchema)) body: AtualizarLotePromoDto) {
    return this.svc.atualizarPromo(id, body);
  }
}
