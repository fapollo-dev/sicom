import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ABAS_HISTORICO, ProdutoHistoricoService, type AbaHistorico, type FiltroHistorico } from './produto-historico.service';
import { ProdutoPosicaoService, type OrigemPosicao } from './produto-posicao.service';
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
  constructor(private readonly svc: ProdutoHistoricoService, private readonly posicao: ProdutoPosicaoService) {}

  /** "[F7] - Análise geral do produto" (TfrmPosicaoProduto): a posição do produto nas lojas (`empresas`) pela origem V (vendas) | P (pedidos) | T (todos) */
  @Get(':id/posicao')
  @RequerAcesso('FRMCADPRODUTO', 'FRMCADPRODUTO')
  posicaoDoProduto(@Param('id', ParseIntPipe) id: number, @Query('empresas') empresas?: string, @Query('origem') origem?: string) {
    return this.posicao.posicao(id, { empresas: filtro({ empresas }).empresas, origem: (origem ?? 'V') as OrigemPosicao });
  }

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

  /** o "Verificar NCM dos produtos ativos" do Outros: os produtos ativos com NCM inválido */
  @Get('ncm/invalidos')
  @RequerAcesso('FRMCADPRODUTO', 'FRMCADPRODUTO')
  ncmInvalidos() {
    return this.svc.ncmInvalidos();
  }

  /** o que a configuração liga no menu Outros (o Duplicar produto — HABILITA_DUPLICAR_PRODUTO) */
  @Get('tela/config')
  @RequerAcesso('FRMCADPRODUTO', 'FRMCADPRODUTO')
  configDaTela() {
    return this.svc.configDaTela();
  }

  /** o "Imprimir" da composição (Rel_ComposicaoProduto.fr3) */
  /** o campo do valor do componente (EMPRESAS.CAMPOCOMPOSICAO) — o Adicionar componente em lote o usa */
  @Get('composicao/campo')
  campoComposicao() {
    return this.svc.campoComposicao();
  }

  @Get(':id/composicao/impressao')
  @RequerAcesso('FRMCADPRODUTO', 'FRMCADPRODUTO')
  impressaoComposicao(@Param('id', ParseIntPipe) id: number) {
    return this.svc.impressaoComposicao(id);
  }
}
