import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relCaixaOpsSchema, type RelCaixaOpsDto } from '@apollo/shared';
import { RelCaixaOpsService } from './rel-caixa-ops.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** OPERAÇÕES DE CAIXA (rel 04/05 do hub). RBAC: o gate do hub — mig 130. */
@Controller('relatorios/caixa-ops')
@UseGuards(AcessoGuard)
export class RelCaixaOpsController {
  constructor(private readonly svc: RelCaixaOpsService) {}

  @Post('sangrias')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  sangrias(@Body(new ZodValidationPipe(relCaixaOpsSchema)) dto: RelCaixaOpsDto) {
    return this.svc.sangrias(dto);
  }

  @Post('liberacoes')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  liberacoes(@Body(new ZodValidationPipe(relCaixaOpsSchema)) dto: RelCaixaOpsDto) {
    return this.svc.liberacoes(dto);
  }
}
