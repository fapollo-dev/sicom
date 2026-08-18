import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  cnabTitulosSchema, cnabEmitirSchema, cnabGerarSchema, cnabRemessasSchema, cnabArquivoSchema,
  type CnabTitulosDto, type CnabEmitirDto, type CnabGerarDto, type CnabRemessasDto, type CnabArquivoDto,
} from '@apollo/shared';
import { CnabRemessaService } from './cnab-remessa.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CNAB de cobrança (FRMCONFBOLETO): a grade de títulos, emitir boleto, gerar a remessa e baixar o arquivo. */
@Controller('cobranca/cnab')
@UseGuards(AcessoGuard)
export class CnabRemessaController {
  constructor(private readonly svc: CnabRemessaService) {}

  @Post('titulos')
  @HttpCode(200)
  @RequerAcesso('FRMCONFBOLETO', 'FRMCONFBOLETO')
  titulos(@Body(new ZodValidationPipe(cnabTitulosSchema)) dto: CnabTitulosDto) {
    return this.svc.titulos(dto);
  }

  @Post('emitir')
  @HttpCode(200)
  @RequerAcesso('FRMCONFBOLETO', 'BTNBOLETO')
  emitir(@Body(new ZodValidationPipe(cnabEmitirSchema)) dto: CnabEmitirDto) {
    return this.svc.emitir(dto.codrcbs);
  }

  @Post('gerar')
  @HttpCode(200)
  @RequerAcesso('FRMCONFBOLETO', 'BTNGERARREMESSA')
  gerar(@Body(new ZodValidationPipe(cnabGerarSchema)) dto: CnabGerarDto) {
    return this.svc.gerar(dto);
  }

  @Post('remessas')
  @HttpCode(200)
  @RequerAcesso('FRMCONFBOLETO', 'FRMCONFBOLETO')
  remessas(@Body(new ZodValidationPipe(cnabRemessasSchema)) dto: CnabRemessasDto) {
    return this.svc.remessas(dto);
  }

  @Post('arquivo')
  @HttpCode(200)
  @RequerAcesso('FRMCONFBOLETO', 'FRMCONFBOLETO')
  arquivo(@Body(new ZodValidationPipe(cnabArquivoSchema)) dto: CnabArquivoDto) {
    return this.svc.arquivo(dto.cod_remessa_areceber);
  }
}
