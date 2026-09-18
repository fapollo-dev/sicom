import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  analiseComportamentoSchema, impostosAdicionarSchema,
  type AnaliseComportamentoDto, type ImpostosAdicionarDto,
} from '@apollo/shared';
import { AnaliseComportamentoService } from './analise-comportamento.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** ANÁLISE DE COMPORTAMENTO DA LOJA (`FRMANALISECOMPORTAMENTO`). RBAC: gate de tela; a lista de impostos grava. */
@Controller('relatorios/analise-comportamento')
@UseGuards(AcessoGuard)
export class AnaliseComportamentoController {
  constructor(private readonly svc: AnaliseComportamentoService) {}

  @Get()
  @RequerAcesso('FRMANALISECOMPORTAMENTO', 'FRMANALISECOMPORTAMENTO')
  gerar(@Query(new ZodValidationPipe(analiseComportamentoSchema)) q: AnaliseComportamentoDto) {
    return this.svc.gerar(q);
  }

  @Get('impostos')
  @RequerAcesso('FRMANALISECOMPORTAMENTO', 'FRMANALISECOMPORTAMENTO')
  listarImpostos() {
    return this.svc.listarImpostos();
  }

  @Post('impostos')
  @HttpCode(200)
  @RequerAcesso('FRMANALISECOMPORTAMENTO', 'BTNGRAVAR')
  adicionarImpostos(@Body(new ZodValidationPipe(impostosAdicionarSchema)) b: ImpostosAdicionarDto) {
    return this.svc.adicionarImpostos(b);
  }

  @Delete('impostos/:codplc')
  @RequerAcesso('FRMANALISECOMPORTAMENTO', 'BTNEXCLUIR')
  removerImposto(@Param('codplc', ParseIntPipe) codplc: number) {
    return this.svc.removerImposto(codplc);
  }
}
