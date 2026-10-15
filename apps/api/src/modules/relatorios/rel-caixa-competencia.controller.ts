import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relCaixaCompetenciaSchema, type RelCaixaCompetenciaDto } from '@apollo/shared';
import { RelCaixaCompetenciaService } from './rel-caixa-competencia.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** RELATÓRIO DE CAIXA — COMPETÊNCIA (FRMRELATORIOCAIXA). A consulta pelo acesso à tela; o Imprimir pela opção BTNIMPRIMIR (Tag 1 — 65 concessões na produção). */
@Controller('relatorios/caixa-competencia')
@UseGuards(AcessoGuard)
export class RelCaixaCompetenciaController {
  constructor(private readonly svc: RelCaixaCompetenciaService) {}

  @Post('consultar')
  @HttpCode(200)
  @RequerAcesso('FRMRELATORIOCAIXA', 'FRMRELATORIOCAIXA')
  consultar(@Body(new ZodValidationPipe(relCaixaCompetenciaSchema)) dto: RelCaixaCompetenciaDto) {
    return this.svc.consultar(dto);
  }

  @Post('impressao')
  @HttpCode(200)
  @RequerAcesso('FRMRELATORIOCAIXA', 'BTNIMPRIMIR')
  impressao(@Body(new ZodValidationPipe(relCaixaCompetenciaSchema)) dto: RelCaixaCompetenciaDto) {
    return this.svc.impressao(dto);
  }
}
