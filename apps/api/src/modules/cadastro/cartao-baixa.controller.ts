import { Body, Get, Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { baixarCartaoSchema, type BaixarCartaoDto } from '@apollo/shared';
import { CartaoBaixaService } from './cartao-baixa.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso, RequerAcessoDeAlgum } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CARTÕES corte-2 — BAIXA / LIQUIDAÇÃO em lote (FRMBAIXACARTAO). Convive no caminho `cadastro/cartao` do CRUD do
 * recebível (sub-rotas distintas): `baixar` (liquida os selecionados num lote, credita a conta) e `estornar-lote`.
 */
@Controller('cadastro/cartao')
@UseGuards(AcessoGuard)
export class CartaoBaixaController {
  constructor(private readonly svc: CartaoBaixaService) {}

  /** as contas do operador (`CONTAS_BANCARIAS_OP`, `edtCodContaExit` :1336) — a F3 da conta de destino */
  @Get('baixa/contas') // 2 segmentos: o GET :id do CRUD (registrado antes) engoliria 'contas'
  @RequerAcesso('FRMBAIXACARTAO', 'BTNGRAVAR')
  contas() { return this.svc.contas(); }

  @Post('baixar')
  @HttpCode(200)
  @RequerAcesso('FRMBAIXACARTAO', 'BTNGRAVAR')
  baixar(@Body(new ZodValidationPipe(baixarCartaoSchema)) body: BaixarCartaoDto) {
    return this.svc.baixar({ codconta: body.codconta, codvendcartaos: body.codvendcartaos, dataBaixa: body.dataBaixa, destino: body.destino, historico: body.historico, codplcTaxa: body.codplcTaxa, outrasDespesas: body.outrasDespesas, codplcOutrasDesp: body.codplcOutrasDesp });
  }

  /** corte-3 (mig 277): as baixas do recebível, com saldo — a baixa parcial que o corte-2 não representava. */
  @Get('baixas/:codvendcartao')
  @RequerAcesso('FRMBAIXACARTAO', 'BTNGRAVAR')
  baixas(@Param('codvendcartao', ParseIntPipe) codvendcartao: number) { return this.svc.baixasDoCartao(codvendcartao); }

  /**
   * a consulta do lote (FRMCONSCRTBX): os cartões baixados e os recursos utilizados. A tela não tem gate próprio — abre pelo "Consulta
   * &titulos" da baixa de cartões (btnConsulta, Tag 1) e pelo "Visualizar títulos" do controle de contas (UconsMovBancaria.pas:969-984)
   */
  @Get('consulta-baixa/:idlote')
  @RequerAcessoDeAlgum(['FRMBAIXACARTAO', 'BTNCONSULTA'], ['FRMCONTROLECONTASBANCARIAS', 'FRMCONTROLECONTASBANCARIAS'])
  consultaBaixa(@Param('idlote', ParseIntPipe) idlote: number) { return this.svc.consultaBaixa(idlote); }

  @Post('estornar-lote/:idlote')
  @HttpCode(200)
  @RequerAcesso('FRMBAIXACARTAO', 'BTNCONSULTA')
  estornarLote(@Param('idlote', ParseIntPipe) idlote: number) {
    return this.svc.estornarLote(idlote);
  }
}
