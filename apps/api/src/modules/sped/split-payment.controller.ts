import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import {
  splitPaymentConfigSchema, splitPaymentConsultaSchema, splitPaymentGerarSchema,
  type SplitPaymentConfigDto, type SplitPaymentConsultaDto, type SplitPaymentGerarDto,
} from '@apollo/shared';
import { SplitPaymentService } from './split-payment.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** SPLIT PAYMENT (corte-7 da reforma, mig 284). DESENVOLVIDO: o legado não tem nada disto. */
@Controller('fiscal/split-payment')
@UseGuards(AcessoGuard)
export class SplitPaymentController {
  constructor(private readonly svc: SplitPaymentService) {}

  @Get('config') @RequerAcesso('FRMAPURACAOIBSCBS', 'FRMAPURACAOIBSCBS')
  obterConfig() { return this.svc.obterConfig(); }

  @Post('config') @HttpCode(200) @RequerAcesso('FRMAPURACAOIBSCBS', 'BTNSPLIT')
  gravarConfig(@Body(new ZodValidationPipe(splitPaymentConfigSchema)) b: SplitPaymentConfigDto) {
    return this.svc.gravarConfig(b);
  }

  @Post('gerar') @HttpCode(200) @RequerAcesso('FRMAPURACAOIBSCBS', 'BTNSPLIT')
  gerar(@Body(new ZodValidationPipe(splitPaymentGerarSchema)) b: SplitPaymentGerarDto) {
    return this.svc.gerar(b);
  }

  @Get() @RequerAcesso('FRMAPURACAOIBSCBS', 'FRMAPURACAOIBSCBS')
  consultar(@Query(new ZodValidationPipe(splitPaymentConsultaSchema)) q: SplitPaymentConsultaDto) {
    return this.svc.consultar(q);
  }
}
