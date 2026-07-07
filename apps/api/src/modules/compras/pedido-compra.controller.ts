import { Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { PedidoCompraService } from './pedido-compra.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * PEDIDO DE COMPRA — controller VERTICAL das transições de ESTADO (fechar/reabrir). Convive no mesmo
 * caminho `compras/pedidos` do controller do agregado (CRUD): as rotas são distintas por método+path
 * (POST :id/fechar ≠ POST do create). RBAC FRMPEDIDOCOMPRA (BTNFECHAR/BTNREABRIR).
 */
@Controller('compras/pedidos')
@UseGuards(AcessoGuard)
export class PedidoCompraController {
  constructor(private readonly svc: PedidoCompraService) {}

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
}
