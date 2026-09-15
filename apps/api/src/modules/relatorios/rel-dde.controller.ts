import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relDdeSchema, type RelDdeDto } from '@apollo/shared';
import { RelDdeService } from './rel-dde.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** DIAS DE ESTOQUE (`FRMRELDDE`) — RBAC: gate de tela. */
@Controller('relatorios/dias-estoque')
@UseGuards(AcessoGuard)
export class RelDdeController {
  constructor(private readonly svc: RelDdeService) {}

  @Get()
  @RequerAcesso('FRMRELDDE', 'FRMRELDDE')
  gerar(@Query(new ZodValidationPipe(relDdeSchema)) q: RelDdeDto) {
    return this.svc.gerar({
      dias: q.dias, coberturaAte: q.coberturaAte ?? null, somenteVendidos: q.somenteVendidos ?? false,
      coddpto: q.coddpto ?? null, codgrupo: q.codgrupo ?? null, codsubgrupo: q.codsubgrupo ?? null,
      codsecao: q.codsecao ?? null, produto: q.produto ?? null,
    });
  }
}
