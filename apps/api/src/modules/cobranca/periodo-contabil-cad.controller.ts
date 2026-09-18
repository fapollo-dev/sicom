import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { periodoContabilSchema, type PeriodoContabilDto } from '@apollo/shared';
import { PeriodoContabilCadService } from './periodo-contabil-cad.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CADASTRO DE PERÍODO CONTÁBIL (`FRMCADPERIODOCONTABIL`) — leitura pela tela; gravar e excluir gravam. */
@Controller('contabil/periodo-contabil')
@UseGuards(AcessoGuard)
export class PeriodoContabilCadController {
  constructor(private readonly svc: PeriodoContabilCadService) {}
  @Get() @RequerAcesso('FRMCADPERIODOCONTABIL', 'FRMCADPERIODOCONTABIL') listar() { return this.svc.listar(); }
  @Get(':cod') @RequerAcesso('FRMCADPERIODOCONTABIL', 'FRMCADPERIODOCONTABIL') obter(@Param('cod', ParseIntPipe) cod: number) { return this.svc.obter(cod); }
  @Post() @RequerAcesso('FRMCADPERIODOCONTABIL', 'BTNGRAVAR') criar(@Body(new ZodValidationPipe(periodoContabilSchema)) b: PeriodoContabilDto) { return this.svc.criar(b); }
  @Put(':cod') @RequerAcesso('FRMCADPERIODOCONTABIL', 'BTNGRAVAR') atualizar(@Param('cod', ParseIntPipe) cod: number, @Body(new ZodValidationPipe(periodoContabilSchema)) b: PeriodoContabilDto) { return this.svc.atualizar(cod, b); }
  @Delete(':cod') @RequerAcesso('FRMCADPERIODOCONTABIL', 'BTNEXCLUIR') excluir(@Param('cod', ParseIntPipe) cod: number) { return this.svc.excluir(cod); }
}
