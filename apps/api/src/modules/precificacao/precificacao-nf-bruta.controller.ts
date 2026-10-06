import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { precificacaoNfBrutaAplicarSchema, precificacaoNfBrutaConsultaSchema, precificacaoNfBrutaImpressaoSchema,
  type PrecificacaoNfBrutaAplicarDto, type PrecificacaoNfBrutaConsultaDto, type PrecificacaoNfBrutaImpressaoDto } from '@apollo/shared';
import { PrecificacaoNfBrutaService } from './precificacao-nf-bruta.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** PRECIFICAÇÃO PELA NF BRUTA (`FRMPRECIFICACAONFBRUTA`) — aplicar tem grant próprio. */
@Controller('precificacao/nf-bruta')
@UseGuards(AcessoGuard)
export class PrecificacaoNfBrutaController {
  constructor(private readonly svc: PrecificacaoNfBrutaService) {}

  @Get()
  @RequerAcesso('FRMPRECIFICACAONFBRUTA', 'FRMPRECIFICACAONFBRUTA')
  consultar(@Query(new ZodValidationPipe(precificacaoNfBrutaConsultaSchema)) q: PrecificacaoNfBrutaConsultaDto) { return this.svc.consultar(q); }

  @Post('aplicar')
  @RequerAcesso('FRMPRECIFICACAONFBRUTA', 'BTNAPLICAR')
  aplicar(@Body(new ZodValidationPipe(precificacaoNfBrutaAplicarSchema)) b: PrecificacaoNfBrutaAplicarDto) { return this.svc.aplicar(b); }

  /** o "Imprimir": a grade como está no PrecificacaoNFBruta.fr3 do cliente */
  @Post('impressao')
  @HttpCode(200)
  @RequerAcesso('FRMPRECIFICACAONFBRUTA', 'FRMPRECIFICACAONFBRUTA')
  impressao(@Body(new ZodValidationPipe(precificacaoNfBrutaImpressaoSchema)) b: PrecificacaoNfBrutaImpressaoDto) { return this.svc.impressao(b); }
}
