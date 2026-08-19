import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { consHistVendasSchema, histVendasListarSchema, type ConsHistVendasDto, type HistVendasListarDto } from '@apollo/shared';
import { ConsHistVendasService } from './cons-hist-vendas.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CONSULTA DE HISTÓRICO DE VENDAS (FRMCONSHISTVENDAS) — corte-1: a consulta de um cupom.
 * RBAC: no golden o form tem UMA opção (o gate da tela), com 63 linhas / 36 operadores.
 */
@Controller('relatorios/hist-vendas')
@UseGuards(AcessoGuard)
export class ConsHistVendasController {
  constructor(private readonly svc: ConsHistVendasService) {}

  @Post('consultar')
  @HttpCode(200)
  @RequerAcesso('FRMCONSHISTVENDAS', 'FRMCONSHISTVENDAS')
  consultar(@Body(new ZodValidationPipe(consHistVendasSchema)) dto: ConsHistVendasDto) {
    return this.svc.consultar(dto);
  }

  /** a LISTA de vendas do período (o botão de pesquisa do legado, sobre GET_HIST_VENDAS). */
  @Post('listar')
  @HttpCode(200)
  @RequerAcesso('FRMCONSHISTVENDAS', 'FRMCONSHISTVENDAS')
  listar(@Body(new ZodValidationPipe(histVendasListarSchema)) dto: HistVendasListarDto) {
    return this.svc.listar(dto);
  }
}
