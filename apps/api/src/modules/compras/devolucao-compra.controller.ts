import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { DevolucaoCompraService } from './devolucao-compra.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * DEVOLUÇÃO DE COMPRA — controller VERTICAL (picker de saldo + transições de estado). Convive no mesmo path
 * `compras/devolucao-compra` do controller do agregado (CRUD) — rotas distintas por método+path. RBAC
 * FRMDEVOLUCAOCOMPRA. corte-1 sem efeitos; gerar-NF (corte-2) entra aqui depois.
 */
@Controller('compras/devolucao-compra')
@UseGuards(AcessoGuard)
export class DevolucaoCompraController {
  constructor(private readonly svc: DevolucaoCompraService) {}

  /** GET itens-disponiveis?codparceiro=&codnf= — itens de NF de entrada do fornecedor com saldo devolvível. */
  @Get('itens-disponiveis')
  itensDisponiveis(@Query('codparceiro', ParseIntPipe) codparceiro: number, @Query('codnf') codnf?: string) {
    return this.svc.itensDisponiveis(codparceiro, codnf ? Number(codnf) : undefined);
  }

  @Post(':id/finalizar')
  @HttpCode(200)
  @RequerAcesso('FRMCADPEDIDODEVOLUCAOCOMPRAS', 'FRMCADPEDIDODEVOLUCAOCOMPRAS')
  finalizar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.finalizar(id);
  }

  @Post(':id/reabrir')
  @HttpCode(200)
  @RequerAcesso('FRMCADPEDIDODEVOLUCAOCOMPRAS', 'FRMCADPEDIDODEVOLUCAOCOMPRAS')
  reabrir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.reabrir(id);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @RequerAcesso('FRMCADPEDIDODEVOLUCAOCOMPRAS', 'FRMCADPEDIDODEVOLUCAOCOMPRAS')
  cancelar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.cancelar(id);
  }

  /** corte-2: gera a NF de SAÍDA de devolução (finalidade=4) do documento DIGITADO. O operador roda F3/F4 na NF. */
  @Post(':id/gerar-nf')
  @HttpCode(200)
  @RequerAcesso('FRMCADPEDIDODEVOLUCAOCOMPRAS', 'FRMCADPEDIDODEVOLUCAOCOMPRAS')
  gerarNf(@Param('id', ParseIntPipe) id: number) {
    return this.svc.gerarNf(id);
  }

  /** fatura a devolução → A RECEBER contra o fornecedor: a parcela da nota de devolução vira título no Faturamento (body: `idpgto`) */
  @Post(':id/faturar')
  @HttpCode(200)
  @RequerAcesso('FRMCADPEDIDODEVOLUCAOCOMPRAS', 'FRMCADPEDIDODEVOLUCAOCOMPRAS')
  faturarNf(@Param('id', ParseIntPipe) id: number, @Body() b: { idpgto?: unknown } = {}) {
    const idpgto = b?.idpgto != null && b.idpgto !== '' ? Number(b.idpgto) : undefined;
    return this.svc.faturarNf(id, { idpgto: Number.isInteger(idpgto) && (idpgto as number) > 0 ? idpgto : undefined });
  }
}
