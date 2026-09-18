import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { configLegislacaoSchema, resolveLegislacaoSchema, type ConfigLegislacaoDto, type ResolveLegislacaoDto } from '@apollo/shared';
import { ConfigLegislacaoService } from './config-legislacao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CONFIGURAÇÃO DE LEGISLAÇÃO DA NF-e (`FRMCONFIGLEGISLACAONFE`). */
@Controller('fiscal/config-legislacao')
@UseGuards(AcessoGuard)
export class ConfigLegislacaoController {
  constructor(private readonly svc: ConfigLegislacaoService) {}
  @Get() @RequerAcesso('FRMCONFIGLEGISLACAONFE', 'FRMCONFIGLEGISLACAONFE') listar(@Query('excluidas') ex?: string) { return this.svc.listar(ex === 'S' || ex === 'true'); }
  @Get('resolver') @RequerAcesso('FRMCONFIGLEGISLACAONFE', 'FRMCONFIGLEGISLACAONFE') resolver(@Query(new ZodValidationPipe(resolveLegislacaoSchema)) q: ResolveLegislacaoDto) { return this.svc.resolver(q); }
  @Get(':id') @RequerAcesso('FRMCONFIGLEGISLACAONFE', 'FRMCONFIGLEGISLACAONFE') obter(@Param('id', ParseIntPipe) id: number) { return this.svc.obter(id); }
  @Post() @RequerAcesso('FRMCONFIGLEGISLACAONFE', 'BTNGRAVAR') criar(@Body(new ZodValidationPipe(configLegislacaoSchema)) b: ConfigLegislacaoDto) { return this.svc.criar(b); }
  @Put(':id') @RequerAcesso('FRMCONFIGLEGISLACAONFE', 'BTNGRAVAR') atualizar(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(configLegislacaoSchema)) b: ConfigLegislacaoDto) { return this.svc.atualizar(id, b); }
  @Delete(':id') @RequerAcesso('FRMCONFIGLEGISLACAONFE', 'BTNEXCLUIR') excluir(@Param('id', ParseIntPipe) id: number) { return this.svc.excluir(id); }
}
