import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ABAS_HISTORICO, ProdutoHistoricoService, type AbaHistorico, type FiltroHistorico } from './produto-historico.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { BusinessRuleError } from '../../shared/errors/app-error';

const aba = (s: string): AbaHistorico => {
  if (!(ABAS_HISTORICO as readonly string[]).includes(s)) throw new BusinessRuleError('HISTORICO_ABA_DESCONHECIDA', { aba: s });
  return s as AbaHistorico;
};
const filtro = (q: Record<string, string | undefined>): FiltroHistorico => ({
  dtini: q.dtini,
  dtfim: q.dtfim,
  empresas: (q.empresas ?? '').split(',').map((e) => Number(e.trim())).filter((e) => Number.isInteger(e) && e > 0),
});

/**
 * HISTÓRICO DAS MOVIMENTAÇÕES do produto e a impressão da composição — rotas de 3+ segmentos sob `cadastro/produtos` (não colidem com
 * o GET `:id` do agregado). A aba é de consulta (Tag 20) e os botões não têm permissão de controle: vale o acesso à tela FRMCADPRODUTO.
 */
@Controller('cadastro/produtos')
@UseGuards(AcessoGuard)
export class ProdutoHistoricoController {
  constructor(private readonly svc: ProdutoHistoricoService) {}

  /** o "Detalhar" de uma linha do kardex: a tela (e a chave) que o legado abre para o movimento */
  @Get(':id/historico/estoque/:codmov/detalhe')
  @RequerAcesso('FRMCADPRODUTO', 'FRMCADPRODUTO')
  detalhar(@Param('id', ParseIntPipe) id: number, @Param('codmov', ParseIntPipe) codmov: number) {
    return this.svc.detalhar(id, codmov);
  }

  /** a sub-aba (`vendas`, `pedidos`, `pedido-compra`, `entradas`, `saidas`, `estoque`, `fornecedores`, `promocao`, `inventario-rotativo`) */
  @Get(':id/historico/:aba')
  @RequerAcesso('FRMCADPRODUTO', 'FRMCADPRODUTO')
  consultar(@Param('id', ParseIntPipe) id: number, @Param('aba') a: string, @Query() q: Record<string, string | undefined>) {
    return this.svc.consultar(id, aba(a), filtro(q));
  }

  /** o "Imprimir" da sub-aba: o layout .fr3 do cliente com o dataset da consulta */
  @Get(':id/historico/:aba/impressao')
  @RequerAcesso('FRMCADPRODUTO', 'FRMCADPRODUTO')
  impressao(@Param('id', ParseIntPipe) id: number, @Param('aba') a: string, @Query() q: Record<string, string | undefined>) {
    return this.svc.impressao(id, aba(a), filtro(q));
  }

  /** o "Imprimir" da composição (Rel_ComposicaoProduto.fr3) */
  @Get(':id/composicao/impressao')
  @RequerAcesso('FRMCADPRODUTO', 'FRMCADPRODUTO')
  impressaoComposicao(@Param('id', ParseIntPipe) id: number) {
    return this.svc.impressaoComposicao(id);
  }
}
