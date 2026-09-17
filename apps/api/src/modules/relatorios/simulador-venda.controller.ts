import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { simuladorVendaSchema, type SimuladorVendaDto } from '@apollo/shared';
import { SimuladorVendaService } from './simulador-venda.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** SIMULADOR DE VENDAS (`FRMSIMULADORVENDA`) — RBAC: gate de tela. */
@Controller('relatorios/simulador-venda')
@UseGuards(AcessoGuard)
export class SimuladorVendaController {
  constructor(private readonly svc: SimuladorVendaService) {}

  @Get()
  @RequerAcesso('FRMSIMULADORVENDA', 'FRMSIMULADORVENDA')
  gerar(@Query(new ZodValidationPipe(simuladorVendaSchema)) q: SimuladorVendaDto) {
    return this.svc.gerar(q);
  }
}
