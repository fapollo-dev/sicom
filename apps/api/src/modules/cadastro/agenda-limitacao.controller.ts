import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { adicionarProdutosSchema, agendaLimitacaoSchema, type AdicionarProdutosDto, type AgendaLimitacaoDto } from '@apollo/shared';
import { AgendaLimitacaoService } from './agenda-limitacao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** AGENDA DE LIMITAÇÃO DE VENDA (`FRMCADAGENDALIMITACAOVENDA`). */
@Controller('cadastro/agenda-limitacao')
@UseGuards(AcessoGuard)
export class AgendaLimitacaoController {
  constructor(private readonly svc: AgendaLimitacaoService) {}

  private op(req: { user?: { codoperador?: number } }): number | null {
    return req?.user?.codoperador ?? null;
  }

  @Get()
  @RequerAcesso('FRMCADAGENDALIMITACAOVENDA', 'FRMCADAGENDALIMITACAOVENDA')
  listar(@Query('abertas') abertas?: string) {
    return this.svc.listar({ abertas: abertas === 'true' });
  }

  @Get(':cod')
  @RequerAcesso('FRMCADAGENDALIMITACAOVENDA', 'FRMCADAGENDALIMITACAOVENDA')
  obter(@Param('cod', ParseIntPipe) cod: number) {
    return this.svc.obter(cod);
  }

  @Post()
  @RequerAcesso('FRMCADAGENDALIMITACAOVENDA', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(agendaLimitacaoSchema)) b: AgendaLimitacaoDto, @Req() req: any) {
    return this.svc.criar(b, this.op(req));
  }

  @Put(':cod')
  @RequerAcesso('FRMCADAGENDALIMITACAOVENDA', 'BTNGRAVAR')
  atualizar(@Param('cod', ParseIntPipe) cod: number, @Body(new ZodValidationPipe(agendaLimitacaoSchema)) b: AgendaLimitacaoDto, @Req() req: any) {
    return this.svc.atualizar(cod, b, this.op(req));
  }

  @Post(':cod/produtos')
  @HttpCode(200)
  @RequerAcesso('FRMCADAGENDALIMITACAOVENDA', 'BTNGRAVAR')
  adicionar(@Param('cod', ParseIntPipe) cod: number, @Body(new ZodValidationPipe(adicionarProdutosSchema)) b: AdicionarProdutosDto, @Req() req: any) {
    return this.svc.adicionarProdutos(cod, b, this.op(req));
  }

  @Put(':cod/itens/:item')
  @RequerAcesso('FRMCADAGENDALIMITACAOVENDA', 'BTNGRAVAR')
  alterarItem(
    @Param('cod', ParseIntPipe) cod: number,
    @Param('item', ParseIntPipe) item: number,
    @Body() body: { quantidade?: number; atualizacao_grupo?: 'S' | 'N'; ativo?: 'S' | 'N' },
  ) {
    return this.svc.alterarItem(cod, item, body ?? {});
  }

  @Delete(':cod/itens/:item')
  @RequerAcesso('FRMCADAGENDALIMITACAOVENDA', 'BTNEXCLUIR')
  excluirItem(@Param('cod', ParseIntPipe) cod: number, @Param('item', ParseIntPipe) item: number) {
    return this.svc.excluirItem(cod, item);
  }

  @Delete(':cod')
  @RequerAcesso('FRMCADAGENDALIMITACAOVENDA', 'BTNEXCLUIR')
  excluir(@Param('cod', ParseIntPipe) cod: number) {
    return this.svc.excluir(cod);
  }
}
