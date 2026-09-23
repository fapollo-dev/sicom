import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { gerarNfPedidoSchema, importarItensPedidoSchema, liberarLimiteSupervisorSchema, type GerarNfPedidoDto, type LiberarLimiteSupervisorDto } from '@apollo/shared';
import { PedidoCompraService } from './pedido-compra.service';
import { PedidoImpressaoService } from './pedido-impressao.service';
import { PedidoItemPrecoService } from './pedido-item-preco.service';
import { RecebimentoService } from './recebimento.service';
import { AnalisePedidoNfService } from './analise-pedido-nf.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * PEDIDO DE COMPRA — controller VERTICAL das transições de ESTADO (fechar/reabrir) + RECEBIMENTO
 * (gerar NF de entrada). Convive no mesmo caminho `compras/pedidos` do controller do agregado (CRUD):
 * as rotas são distintas por método+path. RBAC FRMPEDIDOCOMPRA (BTNFECHAR/BTNREABRIR/BTNGERARNF).
 */
@Controller('compras/pedidos')
@UseGuards(AcessoGuard)
export class PedidoCompraController {
  constructor(
    private readonly svc: PedidoCompraService,
    private readonly recebimento: RecebimentoService,
    private readonly analise: AnalisePedidoNfService,
    private readonly impressaoSvc: PedidoImpressaoService,
    private readonly precoItem: PedidoItemPrecoService,
  ) {}

  /** mig 307 — o PREÇO DO ITEM (o modal `uPrecificacaoProdutos`): créditos, custo líquido, PMZ, sugerida e a escada.
   *  Puro (não grava): o resultado volta ao item e é salvo com o pedido. */
  @Post('precificar-item')
  @HttpCode(200)
  precificarItem(@Body() body: { idproduto: number; vrcusto: number; markup?: number; vrvenda?: number; icme?: number; icm_efetivo?: number; fcp_saida?: number }) {
    return this.precoItem.precificar({
      idproduto: Number(body?.idproduto), vrcusto: Number(body?.vrcusto ?? 0),
      markup: body?.markup ?? null, vrvenda: body?.vrvenda ?? null,
      icme: body?.icme ?? null, icm_efetivo: body?.icm_efetivo ?? null, fcp_saida: body?.fcp_saida ?? null,
    });
  }

  /** mig 307 — o que o item novo herda do catálogo da loja (custo, fator, venda, markup, composição, escada). */
  @Get('heranca/:idproduto')
  heranca(@Param('idproduto', ParseIntPipe) idproduto: number, @Query('codparceiro') codparceiro?: string) {
    return this.svc.heranca(idproduto, codparceiro ? Number(codparceiro) : null);
  }

  /** a IMPRESSÃO do pedido (`ped_compra.fr3` por loja; `?agrupado=1` = `ped_compra_agrupado.fr3`). Leitura: como o
   *  resto da leitura do pedido, sem opção própria — o legado não tem permissão de impressão (0 na PERMISSOES). */
  @Get(':id/impressao')
  impressao(@Param('id', ParseIntPipe) id: number, @Query('agrupado') agrupado?: string) {
    return this.impressaoSvc.impressao(id, agrupado === '1' || agrupado === 'true');
  }

  @Post(':id/fechar')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'MNIFECHARPEDIDO')
  fechar(@Param('id', ParseIntPipe) id: number, @Body() body?: { senhaAdm?: string }) {
    return this.svc.fechar(id, { senhaAdm: body?.senhaAdm });
  }

  @Post(':id/reabrir')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNREABRIR')
  // mig 303: reabre PARA A LOJA LOGADA. Login e senha só quando a lista USUARIOS_REABREM_PEDIDO_COMPRA está
  // preenchida e o operador não está nela (um dos permitidos autoriza) — corpo opcional
  reabrir(@Param('id', ParseIntPipe) id: number, @Body() body?: { login?: string; senha?: string }) {
    return this.svc.reabrir(id, { login: body?.login, senha: body?.senha });
  }

  /** corte-2: gera as parcelas do pedido (ratear pela condição de pagamento). Retorna { codpedcomp, parcelas, total }.
   *  É uma EDIÇÃO do pedido → gated por BTNGRAVAR (opção real do legado; não há "gerar parcelas" no legado). */
  @Post(':id/gerar-parcelas')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGRAVAR')
  gerarParcelas(@Param('id', ParseIntPipe) id: number) {
    return this.svc.gerarParcelas(id);
  }

  /** corte-final: PROPAGA o preço de venda dos itens ao catálogo (MULTI_PRECO) — "Atualizar preço → On-line". */
  @Post(':id/atualizar-precos')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGRAVAR')
  atualizarPrecos(@Param('id', ParseIntPipe) id: number) {
    return this.svc.atualizarPrecos(id);
  }

  /** "Gerar Lote": em vez de aplicar o preço agora, ENFILEIRA lote_preco p/ a tela de Ajuste de Preços (fiel ao
   *  modo alternativo do legado; carimba LTPRECO_PROCESSADO e recusa o 2º gerar-lote do mesmo pedido). */
  @Post(':id/gerar-lote-preco')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGRAVAR')
  gerarLotePreco(@Param('id', ParseIntPipe) id: number) {
    return this.svc.gerarLotePreco(id);
  }

  /** corte-final: duplica o pedido (novo rascunho com itens; datas de hoje; sem parcelas). */
  @Post(':id/duplicar')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGRAVAR')
  duplicar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.duplicar(id, false);
  }

  /** corte-final: gera o pedido-ESPELHO de bonificação (BONIFICACAO='S', itens 100% bonificados). */
  @Post(':id/gerar-bonificado')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGRAVAR')
  gerarBonificado(@Param('id', ParseIntPipe) id: number) {
    return this.svc.duplicar(id, true);
  }

  /** LIBERA o limite (caminho do PRÓPRIO operador): exige o grant LIBERAVALORMAX da SESSÃO (§13). */
  @Post(':id/liberar-limite')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'LIBERAVALORMAX')
  liberarLimite(@Param('id', ParseIntPipe) id: number) {
    return this.svc.liberarLimite(id);
  }

  /** LIBERA o limite via OVERRIDE de SUPERVISOR (E8 c3, ChamaLiberacaoLogin). SEM @RequerAcesso: o operador
   *  da sessão NÃO precisa do grant — é o SUPERVISOR (login+senha) que precisa estar em USUARIOS_LIBERAM_VALOR_MAX_EXCEDIDO
   *  (fold da auditoria: o RBAC na sessão tornava este caminho inalcançável para quem mais precisa dele). */
  @Post(':id/liberar-limite-supervisor')
  @HttpCode(200)
  liberarLimiteSupervisor(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(liberarLimiteSupervisorSchema)) body: LiberarLimiteSupervisorDto,
  ) {
    return this.svc.liberarLimite(id, body);
  }

  /** corte-final: importa itens em massa do fornecedor (associados por CODFOR / já comprados). */
  @Post(':id/importar-itens')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGRAVAR')
  importarItens(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(importarItensPedidoSchema)) body: { origem: 'associados' | 'comprados' },
  ) {
    return this.svc.importarItens(id, body.origem);
  }

  /** mig 314: "Desassociar fornecedor do produto" (uPedidoCompra.pas:2297) — as importações passam a pular o produto. */
  @Post(':id/itens/:idproduto/desassociar')
  @HttpCode(200)
  // o menu do legado não tem permissão própria; é escrita no pedido, como a importação de itens → BTNGRAVAR
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGRAVAR')
  desassociarProduto(@Param('id', ParseIntPipe) id: number, @Param('idproduto', ParseIntPipe) idproduto: number) {
    return this.svc.desassociarProduto(id, idproduto);
  }

  /** RECEBIMENTO PARCIAL 1:N: gera a NF de entrada (rascunho) do SALDO do pedido (ou das `quantidades` explícitas).
   *  Chamável VÁRIAS vezes até o saldo zerar. Retorna { codnf, codpedcomp, statusQtd }. */
  @Post(':id/gerar-nf')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGERARNF')
  gerarNf(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(gerarNfPedidoSchema)) body: GerarNfPedidoDto,
  ) {
    return this.recebimento.gerarNf(id, body);
  }

  /** ANÁLISE PEDIDO×NF (corte-1): saldo por produto do pedido (qtd pedida − Σ recebida nas NFs vinculadas). */
  @Get(':id/saldo')
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGERARNF')
  saldo(@Param('id', ParseIntPipe) id: number) {
    return this.analise.saldo(id);
  }
}
