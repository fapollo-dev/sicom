import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { gerarNfPedidoSchema, importarItensPedidoSchema } from '@apollo/shared';
import { PedidoCompraService } from './pedido-compra.service';
import { RecebimentoService } from './recebimento.service';
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
  ) {}

  @Post(':id/fechar')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNFECHAR')
  fechar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.fechar(id);
  }

  @Post(':id/reabrir')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNREABRIR')
  reabrir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.reabrir(id);
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

  /** LIBERA o limite de compra excedido. Com {login,senha} = override de SUPERVISOR (E8 c3, valida contra
   *  USUARIOS_LIBERAM_VALOR_MAX_EXCEDIDO + LOG_LIBERACOES); sem body = caminho RBAC LIBERAVALORMAX do §13. */
  @Post(':id/liberar-limite')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'LIBERAVALORMAX')
  liberarLimite(@Param('id', ParseIntPipe) id: number, @Body() body?: { login?: string; senha?: string }) {
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

  /** RECEBIMENTO: gera a NF de entrada (rascunho) a partir do pedido. Retorna { codnf, codpedcomp }. */
  @Post(':id/gerar-nf')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGERARNF')
  gerarNf(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(gerarNfPedidoSchema)) body: { modelo?: number; serie?: string; cfop?: string },
  ) {
    return this.recebimento.gerarNf(id, body);
  }
}
