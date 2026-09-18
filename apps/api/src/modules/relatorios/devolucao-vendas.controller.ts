import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { devolucaoVendasBuscaSchema, devolucaoVendasConsultaSchema, devolucaoVendasRegistrarSchema, devolucaoVendasReverterSchema,
  type DevolucaoVendasBuscaDto, type DevolucaoVendasConsultaDto, type DevolucaoVendasRegistrarDto, type DevolucaoVendasReverterDto } from '@apollo/shared';
import { DevolucaoVendasService } from './devolucao-vendas.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** DEVOLUÇÃO DE VENDAS (`FRMDEVOLUCAOVENDAS`) — registrar e reverter têm grant próprio. */
@Controller('relatorios/devolucao-vendas')
@UseGuards(AcessoGuard)
export class DevolucaoVendasController {
  constructor(private readonly svc: DevolucaoVendasService) {}

  @Get('venda')
  @RequerAcesso('FRMDEVOLUCAOVENDAS', 'FRMDEVOLUCAOVENDAS')
  buscar(@Query(new ZodValidationPipe(devolucaoVendasBuscaSchema)) q: DevolucaoVendasBuscaDto) { return this.svc.buscar(q); }

  @Get('motivos')
  @RequerAcesso('FRMDEVOLUCAOVENDAS', 'FRMDEVOLUCAOVENDAS')
  motivos() { return this.svc.motivos(); }

  @Get()
  @RequerAcesso('FRMDEVOLUCAOVENDAS', 'FRMDEVOLUCAOVENDAS')
  consultar(@Query(new ZodValidationPipe(devolucaoVendasConsultaSchema)) q: DevolucaoVendasConsultaDto) { return this.svc.consultar(q); }

  @Post('registrar')
  @RequerAcesso('FRMDEVOLUCAOVENDAS', 'BTNESTORNAR')
  registrar(@Body(new ZodValidationPipe(devolucaoVendasRegistrarSchema)) b: DevolucaoVendasRegistrarDto) { return this.svc.registrar(b); }

  @Post('reverter')
  @RequerAcesso('FRMDEVOLUCAOVENDAS', 'BTNREVERTER')
  reverter(@Body(new ZodValidationPipe(devolucaoVendasReverterSchema)) b: DevolucaoVendasReverterDto) { return this.svc.reverter(b); }
}
