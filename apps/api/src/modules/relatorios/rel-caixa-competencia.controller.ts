import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relCaixaBaixadoSchema, relCaixaCompetenciaSchema, type RelCaixaBaixadoDto, type RelCaixaCompetenciaDto } from '@apollo/shared';
import { RelCaixaCompetenciaService } from './rel-caixa-competencia.service';
import { RelCaixaRegimeService } from './rel-caixa-regime.service';
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

/** RELATÓRIO DE CAIXA — CAIXA BAIXADO (FRMRELATORIOCAIXA). Mesmo gate: a tela; o Imprimir pela BTNIMPRIMIR. */
@Controller('relatorios/caixa-baixado')
@UseGuards(AcessoGuard)
export class RelCaixaBaixadoController {
  constructor(private readonly svc: RelCaixaRegimeService) {}

  @Post('consultar')
  @HttpCode(200)
  @RequerAcesso('FRMRELATORIOCAIXA', 'FRMRELATORIOCAIXA')
  consultar(@Body(new ZodValidationPipe(relCaixaBaixadoSchema)) dto: RelCaixaBaixadoDto) {
    return this.svc.consultarBaixado(dto);
  }

  @Post('impressao')
  @HttpCode(200)
  @RequerAcesso('FRMRELATORIOCAIXA', 'BTNIMPRIMIR')
  impressao(@Body(new ZodValidationPipe(relCaixaBaixadoSchema)) dto: RelCaixaBaixadoDto) {
    return this.svc.impressaoBaixado(dto);
  }
}
