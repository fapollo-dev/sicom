import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { candidatosLoteSchema, gerarFinanceiroLoteSchema, type CandidatosLoteDto, type GerarFinanceiroLoteDto } from '@apollo/shared';
import { GerarFinanceiroLoteService } from './gerar-financeiro-lote.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** GERAR FINANCEIRO EM LOTE (`FRMGERARFINANCEIROLOTE`) — gerar é ato de dinheiro: grant próprio. */
@Controller('cobranca/gerar-financeiro-lote')
@UseGuards(AcessoGuard)
export class GerarFinanceiroLoteController {
  constructor(private readonly svc: GerarFinanceiroLoteService) {}

  @Get('candidatos')
  @RequerAcesso('FRMGERARFINANCEIROLOTE', 'FRMGERARFINANCEIROLOTE')
  candidatos(@Query(new ZodValidationPipe(candidatosLoteSchema)) q: CandidatosLoteDto) { return this.svc.candidatos(q); }

  @Post()
  @RequerAcesso('FRMGERARFINANCEIROLOTE', 'BTNGERAR')
  gerar(@Body(new ZodValidationPipe(gerarFinanceiroLoteSchema)) b: GerarFinanceiroLoteDto) { return this.svc.gerar(b); }
}
