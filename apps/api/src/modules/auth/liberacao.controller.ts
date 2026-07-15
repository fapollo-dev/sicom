import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { LiberacaoService } from './liberacao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * OPERADORES — consulta do LOG_LIBERACOES (auditoria de liberações por supervisor). Corte-1.
 * O registro de eventos é feito por dentro (LiberacaoService.registrar, chamado pelo validar/wire do corte-3).
 */
@Controller('operadores/liberacoes')
@UseGuards(AcessoGuard)
export class LiberacaoController {
  constructor(private readonly svc: LiberacaoService) {}

  @Get()
  @RequerAcesso('FRMLIBERACOES', 'BTNCONSULTAR')
  listar(@Query('dataInicial') dataInicial?: string, @Query('dataFinal') dataFinal?: string, @Query('liberacao') liberacao?: string) {
    return this.svc.listar({ dataInicial, dataFinal, liberacao });
  }
}
