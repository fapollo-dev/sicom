import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relEntradasSaidasSchema, type RelEntradasSaidasDto } from '@apollo/shared';
import { RelEntradasSaidasService } from './rel-entradas-saidas.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** ENTRADAS E SAÍDAS (`FRMRELENTRADASSAIDAS`) — RBAC: gate de tela. */
@Controller('relatorios/entradas-saidas')
@UseGuards(AcessoGuard)
export class RelEntradasSaidasController {
  constructor(private readonly svc: RelEntradasSaidasService) {}

  @Get()
  @RequerAcesso('FRMRELENTRADASSAIDAS', 'FRMRELENTRADASSAIDAS')
  gerar(@Query(new ZodValidationPipe(relEntradasSaidasSchema)) q: RelEntradasSaidasDto) {
    return this.svc.gerar({
      tipo: q.tipo, dataIni: q.dataIni, dataFim: q.dataFim,
      coddpto: q.coddpto ?? null, codgrupo: q.codgrupo ?? null, codsubgrupo: q.codsubgrupo ?? null,
      codfor: q.codfor ?? null, produto: q.produto ?? null,
    });
  }
}
