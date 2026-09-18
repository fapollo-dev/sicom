import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { motivoSchema, type MotivoDto } from '@apollo/shared';
import { MotivosService } from './motivos.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** MOTIVOS DO AJUSTE DE ESTOQUE (`FRMMOTIVO`) — a tabela `MOTIVOS` (≠ motivos de operação, do scrap). */
@Controller('cadastro/motivos')
@UseGuards(AcessoGuard)
export class MotivosController {
  constructor(private readonly svc: MotivosService) {}
  @Get() @RequerAcesso('FRMMOTIVO', 'FRMMOTIVO') listar(@Query('excluidos') excluidos?: string) { return this.svc.listar(excluidos === 'S' || excluidos === 'true'); }
  @Get(':id') @RequerAcesso('FRMMOTIVO', 'FRMMOTIVO') obter(@Param('id', ParseIntPipe) id: number) { return this.svc.obter(id); }
  @Post() @RequerAcesso('FRMMOTIVO', 'BTNGRAVAR') criar(@Body(new ZodValidationPipe(motivoSchema)) b: MotivoDto) { return this.svc.criar(b); }
  @Put(':id') @RequerAcesso('FRMMOTIVO', 'BTNGRAVAR') atualizar(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(motivoSchema)) b: MotivoDto) { return this.svc.atualizar(id, b); }
  @Delete(':id') @RequerAcesso('FRMMOTIVO', 'BTNEXCLUIR') excluir(@Param('id', ParseIntPipe) id: number) { return this.svc.excluir(id); }
}
