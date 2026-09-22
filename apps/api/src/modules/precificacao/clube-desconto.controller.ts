import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  clubeDescontoConsultaSchema, clubeDescontoSchema,
  type ClubeDescontoConsultaDto, type ClubeDescontoDto,
} from '@apollo/shared';
import { ClubeDescontoService } from './clube-desconto.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CLUBE DE DESCONTO — o cadastro das regras (mig 285). */
@Controller('precificacao/clube-desconto')
@UseGuards(AcessoGuard)
export class ClubeDescontoController {
  constructor(private readonly svc: ClubeDescontoService) {}

  @Get() @RequerAcesso('FRMCLUBEDESCONTO', 'FRMCLUBEDESCONTO')
  buscar(@Query(new ZodValidationPipe(clubeDescontoConsultaSchema)) q: ClubeDescontoConsultaDto) { return this.svc.buscar(q); }

  @Get(':id') @RequerAcesso('FRMCLUBEDESCONTO', 'FRMCLUBEDESCONTO')
  obter(@Param('id', ParseIntPipe) id: number) { return this.svc.obter(id); }

  @Post() @RequerAcesso('FRMCLUBEDESCONTO', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(clubeDescontoSchema)) b: ClubeDescontoDto) { return this.svc.gravar(b); }

  @Put(':id') @RequerAcesso('FRMCLUBEDESCONTO', 'BTNGRAVAR')
  atualizar(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(clubeDescontoSchema)) b: ClubeDescontoDto) { return this.svc.gravar(b, id); }

  @Delete(':id') @RequerAcesso('FRMCLUBEDESCONTO', 'BTNEXCLUIR')
  excluir(@Param('id', ParseIntPipe) id: number) { return this.svc.excluir(id); }
}
