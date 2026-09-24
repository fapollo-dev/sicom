import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { lancamentoCaixaSchema, type LancamentoCaixaDto } from '@apollo/shared';
import { LancamentoCaixaService } from './lancamento-caixa.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * LANÇAMENTO DE CAIXA (`FRMMOVCAIXA`, F06; `lancamento-caixa.service.ts`). RBAC do legado: a tela (FRMMOVCAIXA), incluir
 * (BTNADICIONARREGISTRO), editar (BTNEDITAR) e excluir (BTNEXCLUIR) — 136/136/136/77 concessões na produção.
 */
@Controller('cobranca/lancamento-caixa')
@UseGuards(AcessoGuard)
export class LancamentoCaixaController {
  constructor(private readonly svc: LancamentoCaixaService) {}

  @Get()
  @RequerAcesso('FRMMOVCAIXA', 'FRMMOVCAIXA')
  list(@Query('dataIni') dataIni?: string, @Query('dataFim') dataFim?: string, @Query('texto') texto?: string) {
    return this.svc.list({ dataIni, dataFim, texto });
  }

  @Get(':codcx')
  @RequerAcesso('FRMMOVCAIXA', 'FRMMOVCAIXA')
  read(@Param('codcx', ParseIntPipe) codcx: number) {
    return this.svc.read(codcx);
  }

  @Post()
  @RequerAcesso('FRMMOVCAIXA', 'BTNADICIONARREGISTRO')
  criar(@Body(new ZodValidationPipe(lancamentoCaixaSchema)) body: LancamentoCaixaDto) {
    return this.svc.criar(body);
  }

  @Put(':codcx')
  @RequerAcesso('FRMMOVCAIXA', 'BTNEDITAR')
  atualizar(@Param('codcx', ParseIntPipe) codcx: number, @Body(new ZodValidationPipe(lancamentoCaixaSchema)) body: LancamentoCaixaDto) {
    return this.svc.atualizar(codcx, body);
  }

  @Delete(':codcx')
  @HttpCode(204)
  @RequerAcesso('FRMMOVCAIXA', 'BTNEXCLUIR')
  excluir(@Param('codcx', ParseIntPipe) codcx: number) {
    return this.svc.excluir(codcx);
  }
}
