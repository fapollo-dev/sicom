import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { analiseCasaCarneSchema, type AnaliseCasaCarneDto } from '@apollo/shared';
import { AnaliseCasaCarneService } from './analise-casa-carne.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** ANÁLISE COMPRA × VENDA — CASA DE CARNE (`FRMANALISECOMPRAVENDACASACARNE`). */
@Controller('relatorios/analise-casa-carne')
@UseGuards(AcessoGuard)
export class AnaliseCasaCarneController {
  constructor(private readonly svc: AnaliseCasaCarneService) {}

  @Get()
  @RequerAcesso('FRMANALISECOMPRAVENDACASACARNE', 'FRMANALISECOMPRAVENDACASACARNE')
  gerar(@Query(new ZodValidationPipe(analiseCasaCarneSchema)) q: AnaliseCasaCarneDto) {
    return this.svc.gerar(q);
  }
}
