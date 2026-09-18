import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { analiseComportamentoPeriodoSchema, type AnaliseComportamentoPeriodoDto } from '@apollo/shared';
import { AnaliseComportamentoPeriodoService } from './analise-comportamento-periodo.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * ANÁLISE DE COMPORTAMENTO POR PERÍODO (`FRMRELANALISECOMPORTAMENTOPERIODO`). RBAC: gate de tela.
 * POST porque o filtro carrega três períodos aninhados — não cabe em query string sem virar sopa.
 */
@Controller('relatorios/analise-comportamento-periodo')
@UseGuards(AcessoGuard)
export class AnaliseComportamentoPeriodoController {
  constructor(private readonly svc: AnaliseComportamentoPeriodoService) {}

  @Post()
  @RequerAcesso('FRMRELANALISECOMPORTAMENTOPERIODO', 'FRMRELANALISECOMPORTAMENTOPERIODO')
  gerar(@Body(new ZodValidationPipe(analiseComportamentoPeriodoSchema)) f: AnaliseComportamentoPeriodoDto) {
    return this.svc.gerar(f);
  }
}
