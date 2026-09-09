import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relCaixaSchema, type RelCaixaDto } from '@apollo/shared';
import { RelCaixaService } from './rel-caixa.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** RELATÓRIOS DE CAIXA (`FRMRELCAIXA`) — divergências e caixas abertos. RBAC: gate de tela. */
@Controller('cobranca/rel-caixa')
@UseGuards(AcessoGuard)
export class RelCaixaController {
  constructor(private readonly svc: RelCaixaService) {}

  @Get()
  @RequerAcesso('FRMRELCAIXA', 'FRMRELCAIXA')
  gerar(@Query(new ZodValidationPipe(relCaixaSchema)) q: RelCaixaDto) {
    return this.svc.gerar(q.modelo, {
      dataIni: q.dataIni, dataFim: q.dataFim,
      codoperador: q.codoperador ?? null, recurso: q.recurso ?? null,
    });
  }
}
