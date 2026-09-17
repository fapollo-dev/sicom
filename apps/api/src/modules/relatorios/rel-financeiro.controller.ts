import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relFinanceiroSchema, type RelFinanceiroDto } from '@apollo/shared';
import { RelFinanceiroService } from './rel-financeiro.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** RELATÓRIO FINANCEIRO (`FRMRELFINANCEIRO`) — RBAC: gate de tela. */
@Controller('relatorios/financeiro')
@UseGuards(AcessoGuard)
export class RelFinanceiroController {
  constructor(private readonly svc: RelFinanceiroService) {}

  @Get()
  @RequerAcesso('FRMRELFINANCEIRO', 'FRMRELFINANCEIRO')
  gerar(@Query(new ZodValidationPipe(relFinanceiroSchema)) q: RelFinanceiroDto) {
    return this.svc.gerar(q);
  }
}
