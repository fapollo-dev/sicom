import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { consRcbBxLotesSchema, consRcbBxObsSchema, type ConsRcbBxLotesDto, type ConsRcbBxObsDto } from '@apollo/shared';
import { ConsRcbBxService } from './cons-rcb-bx.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CONSULTA DE BAIXAS DO A RECEBER POR LOTE (`FRMCONSRCBBX`) — gate de tela; reverter e gravar OBS gravam. */
@Controller('cobranca/cons-rcb-bx')
@UseGuards(AcessoGuard)
export class ConsRcbBxController {
  constructor(private readonly svc: ConsRcbBxService) {}

  @Get('lotes')
  @RequerAcesso('FRMCONSRCBBX', 'FRMCONSRCBBX')
  lotes(@Query(new ZodValidationPipe(consRcbBxLotesSchema)) q: ConsRcbBxLotesDto) { return this.svc.lotes(q); }

  @Get(':lote')
  @RequerAcesso('FRMCONSRCBBX', 'FRMCONSRCBBX')
  lote(@Param('lote', ParseIntPipe) lote: number) { return this.svc.lote(lote); }

  @Put('baixa/:codrcbbx/obs')
  @RequerAcesso('FRMCONSRCBBX', 'BTNGRAVAR')
  obs(@Param('codrcbbx', ParseIntPipe) codrcbbx: number, @Body(new ZodValidationPipe(consRcbBxObsSchema)) b: ConsRcbBxObsDto) {
    return this.svc.gravarObs(codrcbbx, b.obs);
  }

  @Post(':lote/reverter')
  @HttpCode(200)
  @RequerAcesso('FRMCONSRCBBX', 'BTNREVERTERBAIXA')
  reverter(@Param('lote', ParseIntPipe) lote: number) { return this.svc.reverter(lote); }
}
