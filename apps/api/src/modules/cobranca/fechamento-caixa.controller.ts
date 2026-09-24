import { Body, Controller, Get, HttpCode, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  editarDocumentoFechamentoSchema, efetivarFechamentoSchema, excluirDocumentoFechamentoSchema, inserirDocumentoFechamentoSchema, lancProvCabecalhoSchema, lancProvExcluirSchema,
  lancProvLinhaSchema, rascunhoFechamentoSchema, turnoFechamentoSchema,
  type EditarDocumentoFechamentoDto, type EfetivarFechamentoDto, type ExcluirDocumentoFechamentoDto, type InserirDocumentoFechamentoDto, type LancProvCabecalhoDto,
  type LancProvExcluirDto, type LancProvLinhaDto, type RascunhoFechamentoDto, type TurnoFechamentoDto,
} from '@apollo/shared';
import { FechamentoCaixaService } from './fechamento-caixa.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * FECHAMENTO DE CAIXA — corte 1 (conferência + rascunho), corte 2 (efetivar) e corte 3 (a contabilização no efetivar e a
 * reabertura); `fechamento-caixa.service.ts`. RBAC do legado: a lista de turnos é o botão "Caixas abertos" (BTNCXABERTO);
 * a finalização — fechar ou consultar — abre pelo botão Fechar (BTNFECHA), nos dois modos; reabrir é o BTNREABRIR.
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

  /** o lançamento provisório do turno (BTNLANCPROV): o cabeçalho DADOSCX e as linhas abertas */
  @Get('turno/lancamento-provisorio')
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNLANCPROV')
  lancamentoProvisorio(@Query(new ZodValidationPipe(turnoFechamentoSchema)) q: TurnoFechamentoDto) {
    return this.svc.lancamentoProvisorio(q);
  }

  @Put('turno/lancamento-provisorio')
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNLANCPROV')
  gravarCabecalhoLancProv(@Body(new ZodValidationPipe(lancProvCabecalhoSchema)) body: LancProvCabecalhoDto) {
    return this.svc.gravarCabecalhoLancProv(body);
  }

  @Post('turno/lancamento-provisorio/linhas')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNLANCPROV')
  inserirLinhaLancProv(@Body(new ZodValidationPipe(lancProvLinhaSchema)) body: LancProvLinhaDto) {
    return this.svc.inserirLinhaLancProv(body);
  }

  @Post('turno/lancamento-provisorio/linhas/excluir')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNLANCPROV')
  excluirLinhaLancProv(@Body(new ZodValidationPipe(lancProvExcluirSchema)) body: LancProvExcluirDto) {
    return this.svc.excluirLinhaLancProv(body);
  }

  /** os cupons e itens cancelados do turno (Enter em "Cancelamentos" na finalização) — o diálogo não tem RBAC próprio */
  @Get('turno/cancelamentos')
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNFECHA')
  cancelamentos(@Query(new ZodValidationPipe(turnoFechamentoSchema)) q: TurnoFechamentoDto) {
    return this.svc.cancelamentos(q);
  }

  /** as vendas com descontos do turno (F6 / Enter em "Descontos" na finalização) */
  @Get('turno/descontos')
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNFECHA')
  descontos(@Query(new ZodValidationPipe(turnoFechamentoSchema)) q: TurnoFechamentoDto) {
    return this.svc.descontosDoTurno(q);
  }

  /** o comprovante de quebra de caixa do turno (Imprimir › "Comprovante de quebra de caixa"; o menu não tem RBAC próprio) */
  @Get('turno/quebra')
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNCXABERTO')
  comprovanteQuebra(@Query(new ZodValidationPipe(turnoFechamentoSchema)) q: TurnoFechamentoDto) {
    return this.svc.comprovanteQuebra(q);
  }

  /** o histórico de alterações do turno (Imprimir › "Histórico") */
  @Get('turno/historico')
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNCXABERTO')
  historico(@Query(new ZodValidationPipe(turnoFechamentoSchema)) q: TurnoFechamentoDto) {
    return this.svc.historicoTurno(q);
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

  /** editar um documento no diálogo de documentos (corte 4) — o diálogo não tem RBAC próprio: vale o da finalização */
  @Put('turno/documentos')
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNFECHA')
  editarDocumento(@Body(new ZodValidationPipe(editarDocumentoFechamentoSchema)) body: EditarDocumentoFechamentoDto) {
    return this.svc.editarDocumento(body);
  }

  /** inserir um documento no diálogo (corte 4): o A Receber ORIGEM 'F' e o cartão */
  @Post('turno/documentos')
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNFECHA')
  inserirDocumento(@Body(new ZodValidationPipe(inserirDocumentoFechamentoSchema)) body: InserirDocumentoFechamentoDto) {
    return this.svc.inserirDocumento(body);
  }

  /** excluir um documento no diálogo (corte 4) — com a liberação dos usuários da USUARIOS_PERMITIDOS_EXCLUIR_DOCUMENTOS_FECHAMENTO */
  @Post('turno/documentos/excluir')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNFECHA')
  excluirDocumento(@Body(new ZodValidationPipe(excluirDocumentoFechamentoSchema)) body: ExcluirDocumentoFechamentoDto) {
    return this.svc.excluirDocumento(body);
  }

  /** efetivar o fechamento (corte 2) — o mesmo botão Fechar do legado (BTNFECHA) */
  @Post('turno/efetivar')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNFECHA')
  efetivar(@Body(new ZodValidationPipe(efetivarFechamentoSchema)) body: EfetivarFechamentoDto) {
    return this.svc.efetivar(body);
  }

  /** reabrir o caixa fechado (corte 3) — o botão Reabrir do legado (BTNREABRIR, 117 concessões no cliente) */
  @Post('turno/reabrir')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNREABRIR')
  reabrir(@Body(new ZodValidationPipe(turnoFechamentoSchema)) body: TurnoFechamentoDto) {
    return this.svc.reabrir(body);
  }
}
