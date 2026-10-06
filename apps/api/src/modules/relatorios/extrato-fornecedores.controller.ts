import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { extratoFornecedoresSchema, type ExtratoFornecedoresDto } from '@apollo/shared';
import { ExtratoFornecedoresService } from './extrato-fornecedores.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** EXTRATO DE FORNECEDORES (`FRMEXTRATOFORNECEDORES`) — RBAC: gate de tela. */
@Controller('relatorios/extrato-fornecedores')
@UseGuards(AcessoGuard)
export class ExtratoFornecedoresController {
  constructor(private readonly svc: ExtratoFornecedoresService) {}

  @Get()
  @RequerAcesso('FRMEXTRATOFORNECEDORES', 'FRMEXTRATOFORNECEDORES')
  gerar(@Query(new ZodValidationPipe(extratoFornecedoresSchema)) q: ExtratoFornecedoresDto) {
    return this.svc.gerar(q);
  }

  /** o Imprimir nos layouts do cliente (ExtratoFornecedores1/2/3.fr3, pelo modelo) */
  @Get('impressao')
  @RequerAcesso('FRMEXTRATOFORNECEDORES', 'FRMEXTRATOFORNECEDORES')
  impressao(@Query(new ZodValidationPipe(extratoFornecedoresSchema)) q: ExtratoFornecedoresDto) {
    return this.svc.impressao(q);
  }
}
