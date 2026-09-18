import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { figuraFiscalConsultaSchema, figuraFiscalSchema, type FiguraFiscalConsultaDto, type FiguraFiscalDto } from '@apollo/shared';
import { FiguraFiscalService } from './figura-fiscal.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CADASTRO DE FIGURAS FISCAIS (`FRMCADFIGURASFISCAIS`). */
@Controller('fiscal/figuras-fiscais')
@UseGuards(AcessoGuard)
export class FiguraFiscalController {
  constructor(private readonly svc: FiguraFiscalService) {}
  @Get() @RequerAcesso('FRMCADFIGURASFISCAIS', 'FRMCADFIGURASFISCAIS') buscar(@Query(new ZodValidationPipe(figuraFiscalConsultaSchema)) q: FiguraFiscalConsultaDto) { return this.svc.buscar(q); }
  @Get(':id') @RequerAcesso('FRMCADFIGURASFISCAIS', 'FRMCADFIGURASFISCAIS') obter(@Param('id', ParseIntPipe) id: number) { return this.svc.obter(id); }
  @Post() @RequerAcesso('FRMCADFIGURASFISCAIS', 'BTNGRAVAR') criar(@Body(new ZodValidationPipe(figuraFiscalSchema)) b: FiguraFiscalDto) { return this.svc.criar(b); }
  @Put(':id') @RequerAcesso('FRMCADFIGURASFISCAIS', 'BTNGRAVAR') atualizar(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(figuraFiscalSchema)) b: FiguraFiscalDto) { return this.svc.atualizar(id, b); }
  @Delete(':id') @RequerAcesso('FRMCADFIGURASFISCAIS', 'BTNEXCLUIR') excluir(@Param('id', ParseIntPipe) id: number) { return this.svc.excluir(id); }
}
