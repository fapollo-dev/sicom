import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { extratoFuncionarioSchema, type ExtratoFuncionarioDto } from '@apollo/shared';
import { ExtratoFuncionarioService } from './extrato-funcionario.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** EXTRATO DE FUNCIONÁRIO (`FRMRELFUNCIONARIO`) — RBAC: gate de tela. */
@Controller('cobranca/extrato-funcionario')
@UseGuards(AcessoGuard)
export class ExtratoFuncionarioController {
  constructor(private readonly svc: ExtratoFuncionarioService) {}

  @Get()
  @RequerAcesso('FRMRELFUNCIONARIO', 'FRMRELFUNCIONARIO')
  gerar(@Query(new ZodValidationPipe(extratoFuncionarioSchema)) q: ExtratoFuncionarioDto) { return this.svc.gerar(q); }

  @Get('convenios')
  @RequerAcesso('FRMRELFUNCIONARIO', 'FRMRELFUNCIONARIO')
  convenios() { return this.svc.convenios(); }
}
