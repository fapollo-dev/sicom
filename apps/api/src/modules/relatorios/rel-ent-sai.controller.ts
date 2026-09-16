import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relEntSaiSchema, type RelEntSaiDto } from '@apollo/shared';
import { RelEntSaiService } from './rel-ent-sai.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** ANÁLISE DE COMPRA × VENDA (`FRMRELENTSAI`) — RBAC: gate de tela. */
@Controller('relatorios/compra-venda')
@UseGuards(AcessoGuard)
export class RelEntSaiController {
  constructor(private readonly svc: RelEntSaiService) {}

  @Get()
  @RequerAcesso('FRMRELENTSAI', 'FRMRELENTSAI')
  gerar(@Query(new ZodValidationPipe(relEntSaiSchema)) q: RelEntSaiDto) {
    return this.svc.gerar({
      dataIni: q.dataIni, dataFim: q.dataFim, coddpto: q.coddpto ?? null,
      codgrupo: q.codgrupo ?? null, codsubgrupo: q.codsubgrupo ?? null,
      idproduto: q.idproduto ?? null, codfor: q.codfor ?? null,
      agruparProdutos: q.agruparProdutos ?? false,
    });
  }
}
