import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { baixaReceberGravarSchema, baixaReceberRetornoSchema, baixaReceberTitulosSchema, type BaixaReceberGravarDto, type BaixaReceberRetornoDto, type BaixaReceberTitulosDto } from '@apollo/shared';
import { BaixaReceberLoteService } from './baixa-receber-lote.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso, RequerAcessoDeAlgum } from '../../shared/acesso/requer-acesso.decorator';
import { ReciboBaixaService } from './recibo-baixa.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** BAIXA DE CONTAS A RECEBER (`FRMBAIXAARECEBER`) — a tela, "Iniciar baixa" (`BTNADICIONARREGISTRO`) e `BTNGRAVAR`. */
@Controller('cobranca/baixa-receber')
@UseGuards(AcessoGuard)
export class BaixaReceberLoteController {
  constructor(
    private readonly svc: BaixaReceberLoteService,
    private readonly recibos: ReciboBaixaService,
  ) {}

  @Get('titulos')
  @RequerAcesso('FRMBAIXAARECEBER', 'FRMBAIXAARECEBER')
  titulos(@Query(new ZodValidationPipe(baixaReceberTitulosSchema)) q: BaixaReceberTitulosDto) {
    return this.svc.titulos(q);
  }

  @Get('contas')
  @RequerAcesso('FRMBAIXAARECEBER', 'FRMBAIXAARECEBER')
  contas() {
    return this.svc.contas();
  }

  @Get('padroes')
  @RequerAcesso('FRMBAIXAARECEBER', 'FRMBAIXAARECEBER')
  padroes() {
    return this.svc.padroes();
  }

  /** o recibo no layout do cliente (Config\recibo.fr3) — da baixa ou da consulta de baixas (o "Recibo" do FRMCONSRCBBX) */
  @Get('recibo/:lote/impressao')
  @RequerAcessoDeAlgum(['FRMBAIXAARECEBER', 'FRMBAIXAARECEBER'], ['FRMCONSRCBBX', 'FRMCONSRCBBX'])
  reciboImpressao(@Param('lote', ParseIntPipe) lote: number) {
    return this.recibos.reciboReceber(lote);
  }

  /** o recibo do lote (recibo.fr3) */
  @Get('recibo/:lote')
  @RequerAcesso('FRMBAIXAARECEBER', 'FRMBAIXAARECEBER')
  recibo(@Param('lote', ParseIntPipe) lote: number) {
    return this.svc.recibo(lote);
  }

  @Get('manutencao/:lote')
  @RequerAcesso('FRMBAIXAARECEBER', 'BTNGRAVAR')
  manutencao(@Param('lote', ParseIntPipe) lote: number) {
    return this.svc.manutencao(lote);
  }

  /** "Importar arquivo retorno" (`btnImportaArqRetornoBoletoClick`) — preenche a grade; grava pelo fluxo normal */
  @Post('retorno')
  @HttpCode(200)
  @RequerAcesso('FRMBAIXAARECEBER', 'BTNADICIONARREGISTRO')
  retorno(@Body(new ZodValidationPipe(baixaReceberRetornoSchema)) body: BaixaReceberRetornoDto) {
    return this.svc.retorno(body);
  }

  @Post('iniciar')
  @HttpCode(200)
  @RequerAcesso('FRMBAIXAARECEBER', 'BTNADICIONARREGISTRO')
  iniciar() {
    return this.svc.iniciar();
  }

  @Post('gravar')
  @HttpCode(200)
  @RequerAcesso('FRMBAIXAARECEBER', 'BTNGRAVAR')
  gravar(@Body(new ZodValidationPipe(baixaReceberGravarSchema)) body: BaixaReceberGravarDto) {
    return this.svc.gravar(body);
  }
}
