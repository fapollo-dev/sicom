import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relDiarioContabilSchema, type RelDiarioContabilDto } from '@apollo/shared';
import { RelDiarioContabilService } from './rel-diario-contabil.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** LIVRO DIÁRIO (`FRMRELDIARIOCONTABIL`) — RBAC: gate de tela. */
@Controller('contabil/diario')
@UseGuards(AcessoGuard)
export class RelDiarioContabilController {
  constructor(private readonly svc: RelDiarioContabilService) {}

  @Get()
  @RequerAcesso('FRMRELDIARIOCONTABIL', 'FRMRELDIARIOCONTABIL')
  gerar(@Query(new ZodValidationPipe(relDiarioContabilSchema)) q: RelDiarioContabilDto) { return this.svc.gerar(q); }
}
