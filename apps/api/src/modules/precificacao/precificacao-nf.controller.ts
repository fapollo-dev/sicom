import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  precificacaoNfFiltroSchema, aplicarPrecificacaoNfSchema, precificacaoNfImpressaoSchema,
  type PrecificacaoNfFiltroDto, type AplicarPrecificacaoNfDto, type PrecificacaoNfImpressaoDto,
} from '@apollo/shared';
import { PrecificacaoNfService } from './precificacao-nf.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * PRECIFICAÇÃO DE NF (`FRMPRECIFICACAONF`) — onde o preço nasce quando a mercadoria chega.
 * Os botões da tela não têm Tag (nenhuma permissão de controle; na produção só existe o grant da tela, 59 operadores).
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

  /** o que o FormShow decide ao abrir: o custo do "Considerar", o botão Etiquetas e o rótulo da coluna de markup fixo */
  @Get('tela')
  @RequerAcesso('FRMPRECIFICACAONF', 'FRMPRECIFICACAONF')
  tela() {
    return this.svc.tela();
  }

  /** o exit do Número NF (BuscarNroNotaFiscal): o CODNF da NF de entrada da loja com esse número */
  @Get('nota')
  @RequerAcesso('FRMPRECIFICACAONF', 'FRMPRECIFICACAONF')
  nota(@Query('nronf') nronf?: string) {
    return this.svc.nota(String(nronf ?? '').slice(0, 20));
  }

  /** o "Imprimir" da tela: a grade como está (com o que foi editado e não aplicado) no PrecificacaoNF.fr3 do cliente */
  @Post('impressao')
  @HttpCode(200)
  @RequerAcesso('FRMPRECIFICACAONF', 'FRMPRECIFICACAONF')
  impressao(@Body(new ZodValidationPipe(precificacaoNfImpressaoSchema)) dto: PrecificacaoNfImpressaoDto) {
    return this.svc.impressao(dto);
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

  @Post('aplicar')
  @HttpCode(200)
  @RequerAcesso('FRMPRECIFICACAONF', 'FRMPRECIFICACAONF')
  aplicar(@Body(new ZodValidationPipe(aplicarPrecificacaoNfSchema)) body: AplicarPrecificacaoNfDto) {
    return this.svc.aplicar(body as never);
  }
}
