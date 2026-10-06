import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { simuladorVendaSchema, simuladorVendaImpressaoSchema, type SimuladorVendaDto, type SimuladorVendaImpressaoDto } from '@apollo/shared';
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

  /** o Imprimir com a grade como está (a simulação é da tela) — a opção BTNIMPRIMIR da tela, como no legado */
  @Post('impressao')
  @HttpCode(200)
  @RequerAcesso('FRMSIMULADORVENDA', 'BTNIMPRIMIR')
  impressao(@Body(new ZodValidationPipe(simuladorVendaImpressaoSchema)) dto: SimuladorVendaImpressaoDto) {
    return this.svc.impressao(dto);
  }
}
