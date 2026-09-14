import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  precificacaoNfFiltroSchema, aplicarPrecificacaoNfSchema, etiquetasPrecificacaoNfSchema,
  type PrecificacaoNfFiltroDto, type AplicarPrecificacaoNfDto, type EtiquetasPrecificacaoNfDto,
} from '@apollo/shared';
import { PrecificacaoNfService } from './precificacao-nf.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * PRECIFICAÇÃO DE NF (`FRMPRECIFICACAONF`) — onde o preço nasce quando a mercadoria chega.
 * O gate de tela deixa VER; **aplicar exige permissão própria** (`BTNAPLICAR`), porque é o que muda preço.
 */
@Controller('precificacao/nf')
@UseGuards(AcessoGuard)
export class PrecificacaoNfController {
  constructor(private readonly svc: PrecificacaoNfService) {}

  @Get()
  @RequerAcesso('FRMPRECIFICACAONF', 'FRMPRECIFICACAONF')
  listar(@Query(new ZodValidationPipe(precificacaoNfFiltroSchema)) q: PrecificacaoNfFiltroDto) {
    return this.svc.listar(q as never);
  }

  /** recalcula um item quando o operador mexe no markup ou no preço — a escada é a do FRMPRIFICACAOCUSTO. */
  @Get(':codnfprod/recalcular')
  @RequerAcesso('FRMPRECIFICACAONF', 'FRMPRECIFICACAONF')
  recalcular(
    @Param('codnfprod', ParseIntPipe) codnfprod: number,
    @Query('markup') markup?: string,
    @Query('vrvenda') vrvenda?: string,
  ) {
    return this.svc.recalcular(codnfprod, {
      markup: markup ? Number(markup) : null,
      vrvenda: vrvenda ? Number(vrvenda) : null,
    });
  }

  /** o botão Etiquetas: enfileira os itens marcados e a tela os desmarca, como o legado. */
  @Post('etiquetas')
  @RequerAcesso('FRMPRECIFICACAONF', 'FRMPRECIFICACAONF')
  etiquetas(@Body(new ZodValidationPipe(etiquetasPrecificacaoNfSchema)) b: EtiquetasPrecificacaoNfDto) {
    return this.svc.enfileirarEtiquetas(b.idprodutos);
  }

  @Post('aplicar')
  @HttpCode(200)
  @RequerAcesso('FRMPRECIFICACAONF', 'BTNAPLICAR')
  aplicar(@Body(new ZodValidationPipe(aplicarPrecificacaoNfSchema)) body: AplicarPrecificacaoNfDto) {
    return this.svc.aplicar(body as never);
  }
}
