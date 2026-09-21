import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import {
  nfIbsCbsCalculoSchema, nfIbsCbsConsultaSchema,
  type NfIbsCbsCalculoDto, type NfIbsCbsConsultaDto,
} from '@apollo/shared';
import { NfIbsCbsService } from './nf-ibscbs.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** REFORMA IBS/CBS corte-2: os grupos na nota (mig 279). */
@Controller('fiscal/nf-ibscbs')
@UseGuards(AcessoGuard)
export class NfIbsCbsController {
  constructor(private readonly svc: NfIbsCbsService) {}

  @Get() @RequerAcesso('FRMCADCLASSTRIBIBSCBS', 'FRMCADCLASSTRIBIBSCBS')
  consultar(@Query(new ZodValidationPipe(nfIbsCbsConsultaSchema)) q: NfIbsCbsConsultaDto) { return this.svc.consultar(q); }

  @Post('calcular') @HttpCode(200) @RequerAcesso('FRMCADCLASSTRIBIBSCBS', 'BTNCALCULAR')
  calcular(@Body(new ZodValidationPipe(nfIbsCbsCalculoSchema)) b: NfIbsCbsCalculoDto) { return this.svc.calcular(b); }
}
