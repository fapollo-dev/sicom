import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { criarCotacaoSchema, atualizarCotacaoSchema, lancarPrecosCotacaoSchema, type CriarCotacaoDto, type AtualizarCotacaoDto, type LancarPrecosCotacaoDto } from '@apollo/shared';
import { CotacaoService } from './cotacao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * COTAÇÃO DE COMPRA (FRMCADCOTACAO — uCadCotacao) — corte-1: estrutura + preços. CRUD vertical (árvore 3-4 níveis)
 * + lançar preços + fechar/reabrir. Apuração + gerar-pedido = corte-2. RBAC FRMCADCOTACAO. Leitura só exige auth.
 */
@Controller('compras/cotacao')
@UseGuards(AcessoGuard)
export class CotacaoController {
  constructor(private readonly svc: CotacaoService) {}

  @Get()
  listar() {
    return this.svc.listar();
  }

  @Get(':id')
  obter(@Param('id', ParseIntPipe) id: number) {
    return this.svc.obter(id);
  }

  @Post()
  @RequerAcesso('FRMCADCOTACAO', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(criarCotacaoSchema)) body: CriarCotacaoDto) {
    return this.svc.criar(body);
  }

  @Put(':id')
  @RequerAcesso('FRMCADCOTACAO', 'BTNGRAVAR')
  atualizar(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(atualizarCotacaoSchema)) body: AtualizarCotacaoDto) {
    return this.svc.atualizar(id, body);
  }

  /** lança/atualiza os preços de um fornecedor (matriz fornecedor×produto). */
  @Post(':id/lancar-precos')
  @HttpCode(200)
  @RequerAcesso('FRMCADCOTACAO', 'BTNLANCARPRECOS')
  lancarPrecos(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(lancarPrecosCotacaoSchema)) body: LancarPrecosCotacaoDto) {
    return this.svc.lancarPrecos(id, body);
  }

  @Post(':id/fechar')
  @HttpCode(200)
  @RequerAcesso('FRMCADCOTACAO', 'BTNFECHAR')
  fechar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.fechar(id);
  }

  @Post(':id/reabrir')
  @HttpCode(200)
  @RequerAcesso('FRMCADCOTACAO', 'BTNREABRIR')
  reabrir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.reabrir(id);
  }

  /** exclui (soft-delete) a cotação — só Aberta. */
  @Delete(':id')
  @HttpCode(200)
  @RequerAcesso('FRMCADCOTACAO', 'BTNEXCLUIR')
  excluir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.excluir(id);
  }
}
