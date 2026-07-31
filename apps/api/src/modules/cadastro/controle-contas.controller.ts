import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { lancarContaSchema, transferirContaSchema, type LancarContaDto, type TransferirContaDto } from '@apollo/shared';
import { ControleContasService } from './controle-contas.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CONTROLE DE CONTAS CORRENTES (FRMCONTROLECONTASBANCARIAS) — extrato+saldo, lançamento manual, transferência e estorno.
 */
@Controller('cadastro/controle-contas')
@UseGuards(AcessoGuard)
export class ControleContasController {
  constructor(private readonly svc: ControleContasService) {}

  /** catálogo de operações manuais (C/D). */
  @Get('operacoes')
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNGRAVAR')
  operacoes() {
    return this.svc.operacoes();
  }

  /** saldo (Σ com sinal) + entradas/saídas da conta. */
  @Get('saldo')
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNGRAVAR')
  saldo(@Query('codconta', ParseIntPipe) codconta: number) {
    return this.svc.saldo(codconta);
  }

  /** extrato da conta (movimentos + saldo corrente). */
  @Get('extrato')
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNGRAVAR')
  extrato(@Query('codconta', ParseIntPipe) codconta: number, @Query('dtini') dtini?: string, @Query('dtfim') dtfim?: string) {
    return this.svc.extrato(codconta, dtini, dtfim);
  }

  /** lançamento manual (1 linha; a operação define C/D). */
  @Post('lancar')
  @HttpCode(200)
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNGRAVAR')
  lancar(@Body(new ZodValidationPipe(lancarContaSchema)) body: LancarContaDto) {
    return this.svc.lancar({ codconta: body.codconta, codopconta: body.codopconta, valor: body.valor, historico: body.historico, idpgto: body.idpgto, data: body.data });
  }

  /** transferência entre contas (débito origem + crédito destino, atômica). */
  @Post('transferir')
  @HttpCode(200)
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNGRAVAR')
  transferir(@Body(new ZodValidationPipe(transferirContaSchema)) body: TransferirContaDto) {
    return this.svc.transferir({ codorigem: body.codorigem, coddestino: body.coddestino, valor: body.valor, historico: body.historico, data: body.data });
  }

  /** estorna (apaga) um movimento manual/transferência. */
  @Delete(':id')
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNEXCLUIR')
  estornar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.estornar(id);
  }
}
