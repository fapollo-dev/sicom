import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { scrapLiberacaoExclusaoSchema, type ScrapLiberacaoExclusaoDto } from '@apollo/shared';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { ScrapService } from './scrap.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * SCRAP / PERDAS (FRMCADSCRAP) — ações verticais de baixa de estoque: aplicar (dá baixa no estoque + kardex) e
 * estornar (reverte). Convivem no caminho `cadastro/scrap` do agregado (CRUD do documento) — rotas distintas por
 * método+path. Decopladas do gravar, como o Inventário decopla o `aplicar`.
 */
@Controller('cadastro/scrap')
@UseGuards(AcessoGuard)
export class ScrapController {
  constructor(private readonly svc: ScrapService) {}

  /** o apoio da tela: situações E02, centros de custo de perda, setores, o parceiro da empresa e as configurações.
   *  Dois segmentos: o GET :id do agregado engoliria um só. */
  @Get('apoio/dados')
  @RequerAcesso('FRMCADSCRAP', 'BTNGRAVAR')
  apoio() {
    return this.svc.apoio();
  }

  /** o produto do item pelo código de barras/auxiliar ou pelo código do produto (PLU) — GetProduto/GetProdutoFilho */
  @Get('apoio/produto')
  @RequerAcesso('FRMCADSCRAP', 'BTNADICIONARITEM')
  produto(@Query('codigo') codigo: string, @Query('plu') plu?: string) {
    return this.svc.produto(codigo, String(plu ?? '').toUpperCase() === 'S');
  }

  /** "Excluir" o item gravado: a liberação por login (PEDE_SENHA_EXCLUIR_ITEM_SCRAP) e o gravar com os itens que ficam */
  @Post(':id/excluir-itens')
  @HttpCode(200)
  @RequerAcesso('FRMCADSCRAP', 'BTNEXCLUIRI')
  excluirItens(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(scrapLiberacaoExclusaoSchema)) dto: ScrapLiberacaoExclusaoDto) {
    return this.svc.excluirItens(id, dto);
  }

  /** "Excluir" o documento com a liberação por login */
  @Post(':id/excluir')
  @HttpCode(200)
  @RequerAcesso('FRMCADSCRAP', 'BTNEXCLUIR')
  excluirComLiberacao(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(scrapLiberacaoExclusaoSchema)) dto: ScrapLiberacaoExclusaoDto) {
    return this.svc.excluirComLiberacao(id, dto);
  }

  /** APLICA a baixa de estoque de todos os itens do scrap (mov_estoque='S'). */
  @Post(':id/aplicar')
  @HttpCode(200)
  @RequerAcesso('FRMCADSCRAP', 'BTNGRAVAR')
  aplicar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.aplicar(id);
  }

  /** ESTORNA a baixa de estoque (reverte o saldo). */
  @Post(':id/estornar')
  @HttpCode(200)
  @RequerAcesso('FRMCADSCRAP', 'BTNEXCLUIR')
  estornar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.estornar(id);
  }

  /** "Imprimir Scrap" (o menu sem Tag: o acesso à tela) — o .fr3 do cliente com o scrap e os itens */
  @Get(':id/impressao')
  @RequerAcesso('FRMCADSCRAP', 'FRMCADSCRAP')
  impressao(@Param('id', ParseIntPipe) id: number) {
    return this.svc.impressao(id);
  }
}
