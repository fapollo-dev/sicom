import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relPrecosAlteradosSchema, type RelPrecosAlteradosDto } from '@apollo/shared';
import { RelPrecosAlteradosService } from './rel-precos-alterados.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** RELATÓRIO DE PREÇOS ALTERADOS (`FRMRELPRECOSALTERADOS`) — RBAC: gate de tela. */
@Controller('relatorios/precos-alterados')
@UseGuards(AcessoGuard)
export class RelPrecosAlteradosController {
  constructor(private readonly svc: RelPrecosAlteradosService) {}

  @Get()
  @RequerAcesso('FRMRELPRECOSALTERADOS', 'FRMRELPRECOSALTERADOS')
  gerar(@Query(new ZodValidationPipe(relPrecosAlteradosSchema)) q: RelPrecosAlteradosDto) {
    return this.svc.gerar(q);
  }
}
