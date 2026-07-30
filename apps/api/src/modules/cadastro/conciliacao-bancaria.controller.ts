import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { importarOfxSchema, conciliarSchema, type ImportarOfxDto, type ConciliarDto } from '@apollo/shared';
import { ConciliacaoBancariaService } from './conciliacao-bancaria.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CONCILIAÇÃO BANCÁRIA (OFX) (FRMCONCILIACAOBANCARIA) — importar linhas do extrato, listar pendentes, sugerir o
 * casamento automático (data+valor) e conciliar (marca os dois lados + evento CB).
 */
@Controller('cadastro/conciliacao-bancaria')
@UseGuards(AcessoGuard)
export class ConciliacaoBancariaController {
  constructor(private readonly svc: ConciliacaoBancariaService) {}

  /** importa as linhas do extrato (já parseadas). */
  @Post('importar')
  @HttpCode(200)
  @RequerAcesso('FRMCONCILIACAOBANCARIA', 'BTNIMPORTAR')
  importar(@Body(new ZodValidationPipe(importarOfxSchema)) body: ImportarOfxDto) {
    return this.svc.importar({ codconta: body.codconta, nomeArquivo: body.nomeArquivo, linhas: body.linhas });
  }

  /** pendentes: extrato não-conciliado × razão não-conciliado da conta. */
  @Get('pendentes')
  @RequerAcesso('FRMCONCILIACAOBANCARIA', 'BTNGRAVAR')
  pendentes(@Query('codconta', ParseIntPipe) codconta: number) {
    return this.svc.pendentes(codconta);
  }

  /** sugestão automática de casamento (data+valor). */
  @Get('sugestoes')
  @RequerAcesso('FRMCONCILIACAOBANCARIA', 'BTNGRAVAR')
  sugestoes(@Query('codconta', ParseIntPipe) codconta: number) {
    return this.svc.sugerir(codconta);
  }

  /** concilia os selecionados (Σ valores iguais) → evento CB + marca os dois lados. */
  @Post('conciliar')
  @HttpCode(200)
  @RequerAcesso('FRMCONCILIACAOBANCARIA', 'BTNGRAVAR')
  conciliar(@Body(new ZodValidationPipe(conciliarSchema)) body: ConciliarDto) {
    return this.svc.conciliar({ codconta: body.codconta, mboIds: body.mboIds, codmovcontas: body.codmovcontas });
  }
}
