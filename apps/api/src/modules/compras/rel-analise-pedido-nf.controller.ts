import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relAnalisePedidoNfSchema, type RelAnalisePedidoNfDto } from '@apollo/shared';
import { RelAnalisePedidoNfService } from './rel-analise-pedido-nf.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** RELATÓRIO DE ANÁLISE PEDIDO × NF (`FRMRELANALISEPEDIDONF`) — RBAC: gate de tela. */
@Controller('compras/rel-analise-pedido-nf')
@UseGuards(AcessoGuard)
export class RelAnalisePedidoNfController {
  constructor(private readonly svc: RelAnalisePedidoNfService) {}

  @Get()
  @RequerAcesso('FRMRELANALISEPEDIDONF', 'FRMRELANALISEPEDIDONF')
  gerar(@Query(new ZodValidationPipe(relAnalisePedidoNfSchema)) q: RelAnalisePedidoNfDto) {
    return this.svc.gerar(q);
  }
}
