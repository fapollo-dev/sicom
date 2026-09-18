import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { consApgBxLotesSchema, type ConsApgBxLotesDto } from '@apollo/shared';
import { ConsApgBxService } from './cons-apg-bx.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CONSULTA DE BAIXAS DO A PAGAR POR LOTE (`FRMCONSAPGBX`) — RBAC: gate de tela; reverter exige `BTNREVERTERBAIXA`. */
@Controller('cobranca/cons-apg-bx')
@UseGuards(AcessoGuard)
export class ConsApgBxController {
  constructor(private readonly svc: ConsApgBxService) {}

  @Get('lotes')
  @RequerAcesso('FRMCONSAPGBX', 'FRMCONSAPGBX')
  lotes(@Query(new ZodValidationPipe(consApgBxLotesSchema)) q: ConsApgBxLotesDto) {
    return this.svc.lotes(q);
  }

  @Get(':lote')
  @RequerAcesso('FRMCONSAPGBX', 'FRMCONSAPGBX')
  lote(@Param('lote', ParseIntPipe) lote: number) {
    return this.svc.lote(lote);
  }

  @Post(':lote/reverter')
  @HttpCode(200)
  @RequerAcesso('FRMCONSAPGBX', 'BTNREVERTERBAIXA')
  reverter(@Param('lote', ParseIntPipe) lote: number) {
    return this.svc.reverter(lote);
  }
}
