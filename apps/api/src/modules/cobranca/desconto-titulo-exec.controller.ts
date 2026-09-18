import { Body, Controller, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { descontoTituloExecutarSchema, type DescontoTituloExecutarDto } from '@apollo/shared';
import { DescontoTituloExecService } from './desconto-titulo-exec.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** ENCONTRO DE CONTAS (`FRMDESCONTOTITULO`) corte-2 — executar e reverter são atos de dinheiro: grant próprio. */
@Controller('cobranca/desconto-titulo')
@UseGuards(AcessoGuard)
export class DescontoTituloExecController {
  constructor(private readonly svc: DescontoTituloExecService) {}

  @Post('executar')
  @RequerAcesso('FRMDESCONTOTITULO', 'BTNGRAVAR')
  executar(@Body(new ZodValidationPipe(descontoTituloExecutarSchema)) b: DescontoTituloExecutarDto) { return this.svc.executar(b); }

  @Post(':operacao/reverter')
  @RequerAcesso('FRMDESCONTOTITULO', 'BTNREVERTER')
  reverter(@Param('operacao', ParseIntPipe) operacao: number) { return this.svc.reverter(operacao); }
}
