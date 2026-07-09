import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { gerarNfPedidoSchema } from '@apollo/shared';
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
