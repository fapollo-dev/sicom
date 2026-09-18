import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { exportaNfeSchema, type ExportaNfeDto } from '@apollo/shared';
import { ExportaNfeService } from './exporta-nfe.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** EXPORTAÇÃO DE NF-e (`FRMEXPORTANFE`) — gate de tela. */
@Controller('fiscal/nf-exportacao')
@UseGuards(AcessoGuard)
export class ExportaNfeController {
  constructor(private readonly svc: ExportaNfeService) {}
  @Get() @RequerAcesso('FRMEXPORTANFE', 'FRMEXPORTANFE') listar(@Query(new ZodValidationPipe(exportaNfeSchema)) q: ExportaNfeDto) { return this.svc.listar(q); }
  @Get(':codnf/xml') @RequerAcesso('FRMEXPORTANFE', 'FRMEXPORTANFE') xml(@Param('codnf', ParseIntPipe) codnf: number) { return this.svc.xml(codnf); }
}
