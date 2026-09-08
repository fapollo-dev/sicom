import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { integracaoCartaoSchema, type IntegracaoCartaoDto } from '@apollo/shared';
import { CartaoContabilService } from './cartao-contabil.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * INTEGRAÇÃO CONTÁBIL (`FRMTRON`) — corte-1: BAIXA DE CARTÕES (origens 51, 61 e 62).
 * O legado tem um gate de tela só (`FRMTRON`, 21 operadores no cliente) — não há permissão por botão, e o
 * estorno responde ao mesmo gate (`btnEstornarClick`).
 */
@Controller('contabil/integracao')
@UseGuards(AcessoGuard)
export class IntegracaoContabilController {
  constructor(private readonly cartao: CartaoContabilService) {}

  /** prévia: os lotes que a integração pegaria no período (ou o lote informado). */
  @Get('cartao/pendentes')
  @RequerAcesso('FRMTRON', 'FRMTRON')
  pendentes(@Query(new ZodValidationPipe(integracaoCartaoSchema)) q: IntegracaoCartaoDto) {
    return this.cartao.lotesPendentes({ dataIni: q.dataIni, dataFim: q.dataFim, idlote: q.idlote ?? null });
  }

  @Post('cartao')
  @HttpCode(200)
  @RequerAcesso('FRMTRON', 'FRMTRON')
  integrar(@Body(new ZodValidationPipe(integracaoCartaoSchema)) body: IntegracaoCartaoDto) {
    return this.cartao.integrar({ dataIni: body.dataIni, dataFim: body.dataFim, idlote: body.idlote ?? null });
  }

  @Post('cartao/estornar')
  @HttpCode(200)
  @RequerAcesso('FRMTRON', 'FRMTRON')
  estornar(@Body(new ZodValidationPipe(integracaoCartaoSchema)) body: IntegracaoCartaoDto) {
    return this.cartao.estornar({ dataIni: body.dataIni, dataFim: body.dataFim, idlote: body.idlote ?? null });
  }
}
