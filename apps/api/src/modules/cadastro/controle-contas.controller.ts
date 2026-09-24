import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { chavearContaSchema, type ChavearContaDto, lancarSaldoContaSchema, liberarMovContaSchema, mudarDataLiberacaoSchema, transferirContaSchema, type LancarSaldoContaDto, type LiberarMovContaDto, type MudarDataLiberacaoDto, type TransferirContaDto } from '@apollo/shared';
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

  /** os movimentos a liberar da conta (a pesquisa do "Liberar Movimentações"). */
  @Get('a-liberar')
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNLIBERAR')
  aLiberar(@Query('codconta', ParseIntPipe) codconta: number) {
    return this.svc.aLiberar(codconta);
  }

  /** liberar os movimentos escolhidos na data informada. */
  @Post('liberar')
  @HttpCode(200)
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNLIBERAR')
  liberar(@Body(new ZodValidationPipe(liberarMovContaSchema)) body: LiberarMovContaDto) {
    return this.svc.liberar(body);
  }

  /** "Chavear Fech. Caixa": a data de chaveamento da conta. */
  @Post('chavear')
  @HttpCode(200)
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BITBTN2')
  chavear(@Body(new ZodValidationPipe(chavearContaSchema)) body: ChavearContaDto) {
    return this.svc.chavear(body.codconta, body.data);
  }

  /** "Mudar data de liberação" do detalhamento. */
  @Post(':id/data-liberacao')
  @HttpCode(200)
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'FRMCONTROLECONTASBANCARIAS')
  mudarDataLiberacao(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(mudarDataLiberacaoSchema)) body: MudarDataLiberacaoDto) {
    return this.svc.mudarDataLiberacao(id, body.data);
  }

  /** o Detalhamento da conta (filtros, grade e rodapé do legado). */
  @Get('detalhamento')
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'FRMCONTROLECONTASBANCARIAS')
  detalhamento(
    @Query('codconta', ParseIntPipe) codconta: number, @Query('dtini') dtini?: string, @Query('dtfim') dtfim?: string,
    @Query('liberado') liberado?: string, @Query('dataDe') dataDe?: string, @Query('documento') documento?: string,
  ) {
    const d = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    return this.svc.detalhamento({ codconta, dtini: d(dtini), dtfim: d(dtfim), liberado, dataDe, documento: documento?.slice(0, 30) });
  }

  /** "Visualizar títulos" de um movimento: o lote e a consulta de baixa onde ele está. */
  @Get(':id/titulos')
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'FRMCONTROLECONTASBANCARIAS')
  titulosDoMovimento(@Param('id', ParseIntPipe) id: number) {
    return this.svc.titulosDoMovimento(id);
  }

  /** as modalidades da loja (lançamento de saldo). */
  @Get('modalidades')
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNLANCSALDO')
  modalidades() {
    return this.svc.modalidades();
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

  /** lançamento de saldo (senha ADM, valor com sinal, modalidade, data). */
  @Post('lancar-saldo')
  @HttpCode(200)
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'BTNLANCSALDO')
  lancarSaldo(@Body(new ZodValidationPipe(lancarSaldoContaSchema)) body: LancarSaldoContaDto) {
    return this.svc.lancarSaldo({ codconta: body.codconta, valor: body.valor, idpgto: body.idpgto, historico: body.historico, data: body.data, senhaAdm: body.senhaAdm });
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
