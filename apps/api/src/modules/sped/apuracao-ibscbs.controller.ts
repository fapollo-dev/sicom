import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import {
  apuracaoIbsCbsObterSchema, apuracaoIbsCbsProcessarSchema,
  type ApuracaoIbsCbsObterDto, type ApuracaoIbsCbsProcessarDto,
} from '@apollo/shared';
import { ApuracaoIbsCbsService } from './apuracao-ibscbs.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** APURAÇÃO DE IBS/CBS (corte-3 da reforma, mig 281). DESENVOLVIDO: o legado não apura. */
@Controller('fiscal/apuracao-ibscbs')
@UseGuards(AcessoGuard)
export class ApuracaoIbsCbsController {
  constructor(private readonly svc: ApuracaoIbsCbsService) {}

  @Post('processar') @HttpCode(200) @RequerAcesso('FRMAPURACAOIBSCBS', 'BTNPROCESSAR')
  processar(@Body(new ZodValidationPipe(apuracaoIbsCbsProcessarSchema)) dto: ApuracaoIbsCbsProcessarDto) {
    return this.svc.processar(dto);
  }

  @Get() @RequerAcesso('FRMAPURACAOIBSCBS', 'FRMAPURACAOIBSCBS')
  obter(@Query(new ZodValidationPipe(apuracaoIbsCbsObterSchema)) dto: ApuracaoIbsCbsObterDto) {
    return this.svc.obter(dto);
  }

  @Post('fechar') @HttpCode(200) @RequerAcesso('FRMAPURACAOIBSCBS', 'BTNFECHAR')
  fechar(@Body(new ZodValidationPipe(apuracaoIbsCbsProcessarSchema.pick({ competencia: true }))) dto: { competencia: string }) {
    return this.svc.fechar(dto.competencia);
  }
}
