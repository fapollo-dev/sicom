import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relPerdasSchema, type RelPerdasDto } from '@apollo/shared';
import { RelPerdasService } from './rel-perdas.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** RELATÓRIO DE PERDAS (`FRMRELPERDAS`) — RBAC: gate de tela. */
@Controller('cadastro/rel-perdas')
@UseGuards(AcessoGuard)
export class RelPerdasController {
  constructor(private readonly svc: RelPerdasService) {}

  @Get()
  @RequerAcesso('FRMRELPERDAS', 'FRMRELPERDAS')
  gerar(@Query(new ZodValidationPipe(relPerdasSchema)) q: RelPerdasDto) { return this.svc.gerar(q); }
}
