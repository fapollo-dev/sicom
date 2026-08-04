import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { conferenciaAprovarSchema, conferenciaCancelarSchema, type ConferenciaAprovarDto, type ConferenciaCancelarDto } from '@apollo/shared';
import { ConferenciaNotaService } from './conferencia-nota.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CONFERÊNCIA DE NOTA FISCAL (FRMCONFERENCIANOTA) — corte-1. RBAC: gate de tela (a única opção do form no Oracle).
 * A APROVAÇÃO tem gate próprio por LIBERAÇÃO de supervisor (config USUARIOS_APROVAM_CONFERENCIA_NOTA).
 */
@Controller('compras/conferencia-nota')
@UseGuards(AcessoGuard)
export class ConferenciaNotaController {
  constructor(private readonly svc: ConferenciaNotaService) {}

  /** itens da NF com o que o coletor conferiu + contadores (aprovados / pendentes / conferidos). */
  @Get(':codnf')
  @RequerAcesso('FRMCONFERENCIANOTA', 'FRMCONFERENCIANOTA')
  listar(@Param('codnf', ParseIntPipe) codnf: number) {
    return this.svc.listar(codnf);
  }

  /** aprova os itens selecionados — exige login+senha de um AUTORIZADOR da lista. */
  @Post('aprovar')
  @HttpCode(200)
  @RequerAcesso('FRMCONFERENCIANOTA', 'FRMCONFERENCIANOTA')
  aprovar(@Body(new ZodValidationPipe(conferenciaAprovarSchema)) dto: ConferenciaAprovarDto) {
    return this.svc.aprovar(dto);
  }

  /** cancela a aprovação dos itens selecionados (volta a pendente). */
  @Post('cancelar')
  @HttpCode(200)
  @RequerAcesso('FRMCONFERENCIANOTA', 'FRMCONFERENCIANOTA')
  cancelar(@Body(new ZodValidationPipe(conferenciaCancelarSchema)) dto: ConferenciaCancelarDto) {
    return this.svc.cancelar(dto);
  }
}
