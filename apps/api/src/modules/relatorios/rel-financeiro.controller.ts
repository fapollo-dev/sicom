import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relFinanceiroSchema, relFinanceiroReceberSchema, type RelFinanceiroDto, type RelFinanceiroReceberDto } from '@apollo/shared';
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

  /** o Imprimir da análise descritiva (RelatorioFinanceiroGeral.fr3, com os detalhes por lote) */
  @Get('impressao')
  @RequerAcesso('FRMRELFINANCEIRO', 'FRMRELFINANCEIRO')
  impressao(@Query(new ZodValidationPipe(relFinanceiroSchema)) q: RelFinanceiroDto) {
    return this.svc.impressaoGeral(q);
  }

  /** o 2º relatório da tela: "Contas a receber" */
  @Get('contas-receber')
  @RequerAcesso('FRMRELFINANCEIRO', 'FRMRELFINANCEIRO')
  contasReceber(@Query(new ZodValidationPipe(relFinanceiroReceberSchema)) q: RelFinanceiroReceberDto) {
    return this.svc.contasReceber(q);
  }

  @Get('contas-receber/impressao')
  @RequerAcesso('FRMRELFINANCEIRO', 'FRMRELFINANCEIRO')
  impressaoContasReceber(@Query(new ZodValidationPipe(relFinanceiroReceberSchema)) q: RelFinanceiroReceberDto) {
    return this.svc.impressaoContasReceber(q);
  }
}
