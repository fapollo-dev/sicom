import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { cestConsultaSchema, cestSchema, type CestConsultaDto, type CestDto } from '@apollo/shared';
import { CestService } from './cest.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CADASTRO DE CEST (`FRMCADCEST`). */
@Controller('cadastro/cest')
@UseGuards(AcessoGuard)
export class CestController {
  constructor(private readonly svc: CestService) {}
  @Get() @RequerAcesso('FRMCADCEST', 'FRMCADCEST') buscar(@Query(new ZodValidationPipe(cestConsultaSchema)) q: CestConsultaDto) { return this.svc.buscar(q); }
  @Get('sem-cadastro') @RequerAcesso('FRMCADCEST', 'FRMCADCEST') semCadastro() { return this.svc.semCadastro(); }
  @Get(':id') @RequerAcesso('FRMCADCEST', 'FRMCADCEST') obter(@Param('id', ParseIntPipe) id: number) { return this.svc.obter(id); }
  @Post() @RequerAcesso('FRMCADCEST', 'BTNGRAVAR') criar(@Body(new ZodValidationPipe(cestSchema)) b: CestDto) { return this.svc.criar(b); }
  @Put(':id') @RequerAcesso('FRMCADCEST', 'BTNGRAVAR') atualizar(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(cestSchema)) b: CestDto) { return this.svc.atualizar(id, b); }
  @Delete(':id') @RequerAcesso('FRMCADCEST', 'BTNEXCLUIR') excluir(@Param('id', ParseIntPipe) id: number) { return this.svc.excluir(id); }
}
