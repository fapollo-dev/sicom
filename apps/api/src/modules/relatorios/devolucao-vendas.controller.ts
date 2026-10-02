import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
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
  @RequerAcesso('FRMDEVOLUCAOVENDAS', 'FRMDEVOLUCAOVENDAS')
  registrar(@Body(new ZodValidationPipe(devolucaoVendasRegistrarSchema)) b: DevolucaoVendasRegistrarDto) { return this.svc.registrar(b); }

  /** o extrato da devolução (ven_DevolucaoVendas.fr3): ao registrar e na pré-visualização (`previa: true`) */
  @Post('extrato')
  @HttpCode(200)
  @RequerAcesso('FRMDEVOLUCAOVENDAS', 'FRMDEVOLUCAOVENDAS')
  extrato(@Body(new ZodValidationPipe(devolucaoVendasRegistrarSchema)) b: DevolucaoVendasRegistrarDto, @Query('previa') previa?: string) {
    return this.svc.extrato({ ...b, previa: previa === '1' || previa === 'true' });
  }

  /** a reimpressão dos itens devolvidos do cupom (ven_ItensDevolvidos.fr3); `ocultar=1` = o "Modo preenchimento" */
  @Get('reimpressao')
  @RequerAcesso('FRMDEVOLUCAOVENDAS', 'FRMDEVOLUCAOVENDAS')
  reimpressao(@Query('nrocupom') nrocupom?: string, @Query('nropedido') nropedido?: string, @Query('ocultar') ocultar?: string) {
    return this.svc.reimpressao({ nrocupom: nrocupom ? Number(nrocupom) : undefined, nropedido: nropedido?.trim() || undefined, ocultar: ocultar === '1' });
  }

  @Post('reverter')
  @RequerAcesso('FRMDEVOLUCAOVENDAS', 'FRMDEVOLUCAOVENDAS')
  reverter(@Body(new ZodValidationPipe(devolucaoVendasReverterSchema)) b: DevolucaoVendasReverterDto) { return this.svc.reverter(b); }
}
