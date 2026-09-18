import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relBalancoSchema, type RelBalancoDto } from '@apollo/shared';
import { RelBalancoService } from './rel-balanco.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** BALANÇO PATRIMONIAL (`FRMRELBALANCO`) — RBAC: gate de tela. */
@Controller('contabil/balanco')
@UseGuards(AcessoGuard)
export class RelBalancoController {
  constructor(private readonly svc: RelBalancoService) {}

  @Get()
  @RequerAcesso('FRMRELBALANCO', 'FRMRELBALANCO')
  gerar(@Query(new ZodValidationPipe(relBalancoSchema)) q: RelBalancoDto) { return this.svc.gerar(q); }
}
