import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { relEntradasFinanSchema, relEntradasFinanTitulosSchema, type RelEntradasFinanDto, type RelEntradasFinanTitulosDto } from '@apollo/shared';
import { RelEntradasFinanService } from './rel-entradas-finan.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** ENTRADAS × FINANCEIRO (`FRMRELENTRADAS_FINAN`) — RBAC: gate de tela. */
@Controller('relatorios/entradas-financeiro')
@UseGuards(AcessoGuard)
export class RelEntradasFinanController {
  constructor(private readonly svc: RelEntradasFinanService) {}

  @Get()
  @RequerAcesso('FRMRELENTRADAS_FINAN', 'FRMRELENTRADAS_FINAN')
  gerar(@Query(new ZodValidationPipe(relEntradasFinanSchema)) q: RelEntradasFinanDto) { return this.svc.gerar(q); }

  @Get(':codnf/titulos')
  @RequerAcesso('FRMRELENTRADAS_FINAN', 'FRMRELENTRADAS_FINAN')
  titulos(@Param('codnf', ParseIntPipe) codnf: number, @Query(new ZodValidationPipe(relEntradasFinanTitulosSchema)) q: RelEntradasFinanTitulosDto) {
    return this.svc.titulos(codnf, q);
  }
}
