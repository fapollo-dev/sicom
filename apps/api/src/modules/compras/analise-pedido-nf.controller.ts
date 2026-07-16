import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { liberarConferenciaSchema, type LiberarConferenciaDto } from '@apollo/shared';
import { AnalisePedidoNfService } from './analise-pedido-nf.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * ANÁLISE PEDIDO × NF (Wave 4 corte-2, UanalisaPedComp_NF) — cruzamento/divergências + liberação da conferência de
 * uma NF de entrada vinculada a um pedido. RBAC FRMPEDIDOCOMPRA/BTNLIBERARCONFERENCIA. A liberação COM divergência
 * exige um SUPERVISOR (login+senha ∈ USUARIOS_PERMITIDOS_LIBERAR_PEDIDO_COMPRA) — reusa o E8.
 */
@Controller('compras/analise-pedido-nf')
@UseGuards(AcessoGuard)
export class AnalisePedidoNfController {
  constructor(private readonly svc: AnalisePedidoNfService) {}

  /** divergências (preço/INE_PEDIDO) do cruzamento da NF com seu pedido. */
  @Get(':codnf/divergencias')
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNLIBERARCONFERENCIA')
  divergencias(@Param('codnf', ParseIntPipe) codnf: number) {
    return this.svc.divergencias(codnf);
  }

  /** libera a conferência: sem divergência → direto; com divergência → exige supervisor (login+senha no corpo). */
  @Post(':codnf/liberar')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNLIBERARCONFERENCIA')
  liberar(
    @Param('codnf', ParseIntPipe) codnf: number,
    @Body(new ZodValidationPipe(liberarConferenciaSchema)) body: LiberarConferenciaDto,
  ) {
    return this.svc.liberar(codnf, body);
  }
}
