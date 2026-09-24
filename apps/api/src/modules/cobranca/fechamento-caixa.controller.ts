import { Body, Controller, Get, HttpCode, Post, Put, Query, UseGuards } from '@nestjs/common';
import { efetivarFechamentoSchema, rascunhoFechamentoSchema, turnoFechamentoSchema, type EfetivarFechamentoDto, type RascunhoFechamentoDto, type TurnoFechamentoDto } from '@apollo/shared';
import { FechamentoCaixaService } from './fechamento-caixa.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * FECHAMENTO DE CAIXA — corte 1 (conferência + rascunho; `fechamento-caixa.service.ts`). RBAC do legado: a lista de
 * turnos é o botão "Caixas abertos" (BTNCXABERTO); a finalização — fechar ou consultar — abre pelo botão Fechar
 * (BTNFECHA), nos dois modos.
 */
@Controller('cobranca/fechamento-caixa')
@UseGuards(AcessoGuard)
export class FechamentoCaixaController {
  constructor(private readonly svc: FechamentoCaixaService) {}

  @Get('turnos')
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNCXABERTO')
  turnos(@Query('data') data?: string) {
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new BusinessRuleError('FECHAMENTO_DATA_OBRIGATORIA');
    return this.svc.turnos(data);
  }

  @Get('turno')
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNFECHA')
  detalhe(@Query(new ZodValidationPipe(turnoFechamentoSchema)) q: TurnoFechamentoDto) {
    return this.svc.detalhe(q);
  }

  @Get('turno/documentos')
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNFECHA')
  documentos(@Query(new ZodValidationPipe(turnoFechamentoSchema)) q: TurnoFechamentoDto, @Query('operacao') operacao?: string) {
    if (!operacao) throw new BusinessRuleError('FECHAMENTO_OPERACAO_FORA_DO_TURNO', { operacao: '' });
    return this.svc.documentos(q, operacao);
  }

  @Post('turno/abrir')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNFECHA')
  abrir(@Body(new ZodValidationPipe(turnoFechamentoSchema)) body: TurnoFechamentoDto) {
    return this.svc.abrir(body);
  }

  @Put('turno/rascunho')
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNFECHA')
  rascunho(@Body(new ZodValidationPipe(rascunhoFechamentoSchema)) body: RascunhoFechamentoDto) {
    return this.svc.salvarRascunho(body);
  }

  /** efetivar o fechamento (corte 2) — o mesmo botão Fechar do legado (BTNFECHA) */
  @Post('turno/efetivar')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNFECHA')
  efetivar(@Body(new ZodValidationPipe(efetivarFechamentoSchema)) body: EfetivarFechamentoDto) {
    return this.svc.efetivar(body);
  }
}
