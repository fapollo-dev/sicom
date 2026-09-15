import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { pedidoVendaFiltroSchema, type PedidoVendaFiltroDto } from '@apollo/shared';
import { PedidoVendaService } from './pedido-venda.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** DIGITAÇÃO DE PEDIDOS (`FRMDIGITACAOPEDIDOS`) — pedido de VENDA. RBAC: gate de tela. */
@Controller('compras/pedido-venda')
@UseGuards(AcessoGuard)
export class PedidoVendaController {
  constructor(private readonly svc: PedidoVendaService) {}

  @Get()
  @RequerAcesso('FRMDIGITACAOPEDIDOS', 'FRMDIGITACAOPEDIDOS')
  listar(@Query(new ZodValidationPipe(pedidoVendaFiltroSchema)) q: PedidoVendaFiltroDto) {
    return this.svc.listar({
      dataIni: q.dataIni, dataFim: q.dataFim, nropedido: q.nropedido ?? null,
      codparceiro: q.codparceiro ?? null, incluirCancelados: q.incluirCancelados ?? false,
    });
  }

  @Get(':nropedido')
  @RequerAcesso('FRMDIGITACAOPEDIDOS', 'FRMDIGITACAOPEDIDOS')
  abrir(@Param('nropedido') nropedido: string) {
    return this.svc.abrir(nropedido);
  }

  /** o botão que aplica a promoção acumulativa no pedido inteiro. */
  @Post(':nropedido/promocao-acumulativa')
  @RequerAcesso('FRMDIGITACAOPEDIDOS', 'FRMDIGITACAOPEDIDOS')
  promocao(@Param('nropedido') nropedido: string) {
    return this.svc.aplicarPromocaoAcumulativa(nropedido);
  }
}
