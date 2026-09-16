import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relFaturamentoSchema, type RelFaturamentoDto } from '@apollo/shared';
import { RelFaturamentoService } from './rel-faturamento.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** FATURAMENTO POR MÊS (`FRMRELFATURAMENTO`) — RBAC: gate de tela. */
@Controller('relatorios/faturamento')
@UseGuards(AcessoGuard)
export class RelFaturamentoController {
  constructor(private readonly svc: RelFaturamentoService) {}

  @Get()
  @RequerAcesso('FRMRELFATURAMENTO', 'FRMRELFATURAMENTO')
  gerar(@Query(new ZodValidationPipe(relFaturamentoSchema)) q: RelFaturamentoDto) {
    return this.svc.gerar({ dataIni: q.dataIni, dataFim: q.dataFim });
  }
}
