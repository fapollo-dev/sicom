import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import {
  faturamentoSchema, parcelasFaturamentoSchema, processarFaturamentoSchema,
  type FaturamentoDto, type ParcelasFaturamentoDto, type ProcessarFaturamentoDto,
} from '@apollo/shared';
import { FaturamentoService } from './faturamento.service';
import { NfFaturamentoService } from '../cadastro/nf-faturamento.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * FATURAMENTO DA NOTA (`FRMFATURAMENTO2`) — RBAC: gate de tela (a produção só concede FRMFATURAMENTO2 e BTNIMPRIMIR: o Processar e o
 * Bonificar não têm permissão própria no legado).
 */
@Controller('compras/faturamento')
@UseGuards(AcessoGuard)
export class FaturamentoController {
  constructor(
    private readonly svc: FaturamentoService,
    private readonly fat: NfFaturamentoService,
  ) {}

  @Get()
  @RequerAcesso('FRMFATURAMENTO2', 'FRMFATURAMENTO2')
  listar(@Query(new ZodValidationPipe(faturamentoSchema)) q: FaturamentoDto) {
    return this.svc.listar(q);
  }

  /** o pré-lançamento das parcelas escolhidas (o que a tela de Contas a Pagar / Receber mostra antes de gravar) */
  @Post('previa')
  @HttpCode(200)
  @RequerAcesso('FRMFATURAMENTO2', 'FRMFATURAMENTO2')
  previa(@Body(new ZodValidationPipe(parcelasFaturamentoSchema)) b: ParcelasFaturamentoDto) {
    return this.fat.previa(b.codfaturamento);
  }

  /** Processar (F2): parcela → título */
  @Post('processar')
  @HttpCode(200)
  @RequerAcesso('FRMFATURAMENTO2', 'FRMFATURAMENTO2')
  processar(@Body(new ZodValidationPipe(processarFaturamentoSchema)) b: ProcessarFaturamentoDto) {
    return this.fat.processar(b);
  }

  /** Bonificar (F4): a parcela sai sem título */
  @Post('bonificar')
  @HttpCode(200)
  @RequerAcesso('FRMFATURAMENTO2', 'FRMFATURAMENTO2')
  bonificar(@Body(new ZodValidationPipe(parcelasFaturamentoSchema)) b: ParcelasFaturamentoDto) {
    return this.fat.bonificar(b.codfaturamento);
  }
}
