import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relPedidosCompraSchema, type RelPedidosCompraDto } from '@apollo/shared';
import { RelPedidosCompraService } from './rel-pedidos-compra.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** RELATÓRIO DE PEDIDOS DE COMPRA — previsão de pagamentos (`FRMRELPEDIDOCOMPRA`). RBAC: gate de tela, como no legado. */
@Controller('relatorios/pedidos-compra')
@UseGuards(AcessoGuard)
export class RelPedidosCompraController {
  constructor(private readonly svc: RelPedidosCompraService) {}

  @Get()
  @RequerAcesso('FRMRELPEDIDOCOMPRA', 'FRMRELPEDIDOCOMPRA')
  gerar(@Query(new ZodValidationPipe(relPedidosCompraSchema)) q: RelPedidosCompraDto) {
    return this.svc.gerar(q);
  }
}
