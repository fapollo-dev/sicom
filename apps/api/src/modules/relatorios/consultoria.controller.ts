import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { consultoriaSchema, type ConsultoriaDto } from '@apollo/shared';
import { ConsultoriaService } from './consultoria.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CONSULTORIA APOLLO (`FRMCONSULTORIAATM`) — participação e rentabilidade por nível. RBAC: gate de tela. */
@Controller('relatorios/consultoria')
@UseGuards(AcessoGuard)
export class ConsultoriaController {
  constructor(private readonly svc: ConsultoriaService) {}

  @Get()
  @RequerAcesso('FRMCONSULTORIAATM', 'FRMCONSULTORIAATM')
  participacao(@Query(new ZodValidationPipe(consultoriaSchema)) q: ConsultoriaDto) {
    return this.svc.participacao({ nivel: q.nivel, dataIni: q.dataIni, dataFim: q.dataFim });
  }
}
