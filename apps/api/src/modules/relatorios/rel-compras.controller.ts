import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relComprasSchema, type RelComprasDto } from '@apollo/shared';
import { RelComprasService } from './rel-compras.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** RELATÓRIOS DE COMPRAS (`FRMRELCOMPRAS`) — os três do combo. RBAC: gate de tela, como no legado. */
@Controller('relatorios/compras')
@UseGuards(AcessoGuard)
export class RelComprasController {
  constructor(private readonly svc: RelComprasService) {}

  @Get()
  @RequerAcesso('FRMRELCOMPRAS', 'FRMRELCOMPRAS')
  gerar(@Query(new ZodValidationPipe(relComprasSchema)) q: RelComprasDto) {
    return this.svc.gerar({
      tipo: q.tipo, dataIni: q.dataIni, dataFim: q.dataFim,
      campoData: q.campoData ?? null, considerar: q.considerar ?? null,
      coddpto: q.coddpto ?? null, codgrupo: q.codgrupo ?? null,
      codsubgrupo: q.codsubgrupo ?? null, codsecao: q.codsecao ?? null,
      idproduto: q.idproduto ?? null, codparceiro: q.codparceiro ?? null,
      cfops: q.cfops ?? null, empresas: q.empresas ?? null,
    });
  }
}
