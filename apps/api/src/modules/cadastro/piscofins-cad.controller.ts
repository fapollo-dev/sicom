import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { pisCofinsSchema, type PisCofinsDto } from '@apollo/shared';
import { PisCofinsCadService } from './piscofins-cad.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CADASTRO DE PIS/COFINS (`FRMCADPISCOFINS`). */
@Controller('cadastro/piscofins')
@UseGuards(AcessoGuard)
export class PisCofinsCadController {
  constructor(private readonly svc: PisCofinsCadService) {}
  @Get() @RequerAcesso('FRMCADPISCOFINS', 'FRMCADPISCOFINS') listar() { return this.svc.listar(); }
  @Get('tipos-credito') @RequerAcesso('FRMCADPISCOFINS', 'FRMCADPISCOFINS') tiposCredito() { return this.svc.tiposCredito(); }
  @Get(':id') @RequerAcesso('FRMCADPISCOFINS', 'FRMCADPISCOFINS') obter(@Param('id', ParseIntPipe) id: number) { return this.svc.obter(id); }
  @Post() @RequerAcesso('FRMCADPISCOFINS', 'BTNGRAVAR') criar(@Body(new ZodValidationPipe(pisCofinsSchema)) b: PisCofinsDto) { return this.svc.criar(b); }
  @Put(':id') @RequerAcesso('FRMCADPISCOFINS', 'BTNGRAVAR') atualizar(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(pisCofinsSchema)) b: PisCofinsDto) { return this.svc.atualizar(id, b); }
  @Delete(':id') @RequerAcesso('FRMCADPISCOFINS', 'BTNEXCLUIR') excluir(@Param('id', ParseIntPipe) id: number) { return this.svc.excluir(id); }
}
