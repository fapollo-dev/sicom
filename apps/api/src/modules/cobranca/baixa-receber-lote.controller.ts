import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { baixaReceberGravarSchema, baixaReceberTitulosSchema, type BaixaReceberGravarDto, type BaixaReceberTitulosDto } from '@apollo/shared';
import { BaixaReceberLoteService } from './baixa-receber-lote.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** BAIXA DE CONTAS A RECEBER (`FRMBAIXAARECEBER`) — a tela, "Iniciar baixa" (`BTNADICIONARREGISTRO`) e `BTNGRAVAR`. */
@Controller('cobranca/baixa-receber')
@UseGuards(AcessoGuard)
export class BaixaReceberLoteController {
  constructor(private readonly svc: BaixaReceberLoteService) {}

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

  @Get('manutencao/:lote')
  @RequerAcesso('FRMBAIXAARECEBER', 'BTNGRAVAR')
  manutencao(@Param('lote', ParseIntPipe) lote: number) {
    return this.svc.manutencao(lote);
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
