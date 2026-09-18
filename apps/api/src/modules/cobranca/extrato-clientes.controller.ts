import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { extratoClientesSchema, type ExtratoClientesDto } from '@apollo/shared';
import { ExtratoClientesService } from './extrato-clientes.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** EXTRATO DE CLIENTES (`FRMEXTRATOCLIENTES`) — gate de tela. */
@Controller('cobranca/extrato-clientes')
@UseGuards(AcessoGuard)
export class ExtratoClientesController {
  constructor(private readonly svc: ExtratoClientesService) {}
  @Get() @RequerAcesso('FRMEXTRATOCLIENTES', 'FRMEXTRATOCLIENTES') gerar(@Query(new ZodValidationPipe(extratoClientesSchema)) q: ExtratoClientesDto) { return this.svc.gerar(q); }
}
