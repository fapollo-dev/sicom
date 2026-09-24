import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { lancarContaSchema, transferirContaSchema, type LancarContaDto, type TransferirContaDto } from '@apollo/shared';
import { ControleContasService } from './controle-contas.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CONTROLE DE CONTAS CORRENTES (FRMCONTROLECONTASBANCARIAS) — as opções do legado (`PERMISSOES`): a tela, `BTNFECHA`
 * (transferência e remover), `BTNLANCSALDO` (lançamento), `BTNLIBERAR`, `BITBTN2` (chavear).
 */
@Controller('cadastro/controle-contas')
@UseGuards(AcessoGuard)
export class ControleContasController {
  constructor(private readonly svc: ControleContasService) {}

  /** a lista de contas do operador (com as permissões por conta). */
  @Get('contas')
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'FRMCONTROLECONTASBANCARIAS')
  contas() {
    return this.svc.contas();
  }

  /** os destinos da transferência (qualquer conta ativa). */
  @Get('destinos')
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNFECHA')
  destinos() {
    return this.svc.destinos();
  }

  /** catálogo de operações manuais (C/D). */
  @Get('operacoes')
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNLANCSALDO')
  operacoes() {
    return this.svc.operacoes();
  }

  /** saldo (Σ com sinal) + entradas/saídas da conta. */
  @Get('saldo')
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'FRMCONTROLECONTASBANCARIAS')
  saldo(@Query('codconta', ParseIntPipe) codconta: number, @Query('ateData') ateData?: string) {
    return this.svc.saldo(codconta, ateData && /^\d{4}-\d{2}-\d{2}$/.test(ateData) ? ateData : undefined);
  }

  /** extrato da conta (movimentos + saldo corrente). */
  @Get('extrato')
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'FRMCONTROLECONTASBANCARIAS')
  extrato(@Query('codconta', ParseIntPipe) codconta: number, @Query('dtini') dtini?: string, @Query('dtfim') dtfim?: string) {
    return this.svc.extrato(codconta, dtini, dtfim);
  }

  /** lançamento manual (1 linha; a operação define C/D). */
  @Post('lancar')
  @HttpCode(200)
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNLANCSALDO')
  lancar(@Body(new ZodValidationPipe(lancarContaSchema)) body: LancarContaDto) {
    return this.svc.lancar({ codconta: body.codconta, codopconta: body.codopconta, valor: body.valor, historico: body.historico, idpgto: body.idpgto, data: body.data });
  }

  /** transferência entre contas (débito origem + crédito destino, atômica). */
  @Post('transferir')
  @HttpCode(200)
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNFECHA')
  transferir(@Body(new ZodValidationPipe(transferirContaSchema)) body: TransferirContaDto) {
    return this.svc.transferir({ codorigem: body.codorigem, coddestino: body.coddestino, valor: body.valor, historico: body.historico, data: body.data, idpgtoOrigem: body.idpgtoOrigem, idpgtoDestino: body.idpgtoDestino });
  }

  /** remove a transferência (o lote inteiro) ou a movimentação sem lote. */
  @Delete(':id')
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNFECHA')
  estornar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.estornar(id);
  }
}
