import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { baixaApagarGravarSchema, baixaApagarTitulosSchema, type BaixaApagarGravarDto, type BaixaApagarTitulosDto } from '@apollo/shared';
import { BaixaApagarLoteService } from './baixa-apagar-lote.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** BAIXA DE CONTAS A PAGAR (`FRMBAIXAAPAGAR`) — as opções do legado: a tela, "Iniciar baixa" (`BTNADICIONARREGISTRO`) e `BTNGRAVAR`. */
@Controller('cobranca/baixa-apagar')
@UseGuards(AcessoGuard)
export class BaixaApagarLoteController {
  constructor(private readonly svc: BaixaApagarLoteService) {}

  @Get('titulos')
  @RequerAcesso('FRMBAIXAAPAGAR', 'FRMBAIXAAPAGAR')
  titulos(@Query(new ZodValidationPipe(baixaApagarTitulosSchema)) q: BaixaApagarTitulosDto) {
    return this.svc.titulos(q);
  }

  @Get('contas')
  @RequerAcesso('FRMBAIXAAPAGAR', 'FRMBAIXAAPAGAR')
  contas() {
    return this.svc.contas();
  }

  @Get('padroes')
  @RequerAcesso('FRMBAIXAAPAGAR', 'FRMBAIXAAPAGAR')
  padroes() {
    return this.svc.padroes();
  }

  /** o recibo do lote (recibopagar.fr3) */
  @Get('recibo/:lote')
  @RequerAcesso('FRMBAIXAAPAGAR', 'FRMBAIXAAPAGAR')
  recibo(@Param('lote', ParseIntPipe) lote: number) {
    return this.svc.recibo(lote);
  }

  /** a manutenção entra pela consulta de baixas (o botão de manutenção do FRMCONSAPGBX) */
  @Get('manutencao/:lote')
  @RequerAcesso('FRMBAIXAAPAGAR', 'BTNGRAVAR')
  manutencao(@Param('lote', ParseIntPipe) lote: number) {
    return this.svc.manutencao(lote);
  }

  @Post('iniciar')
  @HttpCode(200)
  @RequerAcesso('FRMBAIXAAPAGAR', 'BTNADICIONARREGISTRO')
  iniciar() {
    return this.svc.iniciar();
  }

  @Post('gravar')
  @HttpCode(200)
  @RequerAcesso('FRMBAIXAAPAGAR', 'BTNGRAVAR')
  gravar(@Body(new ZodValidationPipe(baixaApagarGravarSchema)) body: BaixaApagarGravarDto) {
    return this.svc.gravar(body);
  }
}
