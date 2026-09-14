import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { conferenciaNfIndexadorSchema, type ConferenciaNfIndexadorDto } from '@apollo/shared';
import { ConferenciaNfIndexadorService } from './conferencia-nf-indexador.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CONFERÊNCIA NF × INDEXADOR (`FRMCONFERENCIANFINDEXADOR`) — RBAC: gate de tela. */
@Controller('fiscal/conferencia-nf-indexador')
@UseGuards(AcessoGuard)
export class ConferenciaNfIndexadorController {
  constructor(private readonly svc: ConferenciaNfIndexadorService) {}

  @Get()
  @RequerAcesso('FRMCONFERENCIANFINDEXADOR', 'FRMCONFERENCIANFINDEXADOR')
  listar(@Query(new ZodValidationPipe(conferenciaNfIndexadorSchema)) q: ConferenciaNfIndexadorDto) {
    return this.svc.listar({
      dataIni: q.dataIni, dataFim: q.dataFim, tipo: q.tipo ?? null,
      nronf: q.nronf ?? null, codparceiro: q.codparceiro ?? null, produto: q.produto ?? null,
      incluirProcessadas: q.incluirProcessadas ?? false,
      incluirCanceladas: q.incluirCanceladas ?? false,
      somenteDivergentes: q.somenteDivergentes ?? false,
    });
  }
}
