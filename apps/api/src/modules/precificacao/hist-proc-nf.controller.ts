import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { histProcNfConsultaSchema, type HistProcNfConsultaDto } from '@apollo/shared';
import { HistProcNfService } from './hist-proc-nf.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** HISTÓRICO DE PROCESSAMENTO DA NF — por que o custo do produto mudou (mig 291). Só leitura. */
@Controller('precificacao/hist-processamento-nf')
@UseGuards(AcessoGuard)
export class HistProcNfController {
  constructor(private readonly svc: HistProcNfService) {}

  @Get() @RequerAcesso('FRMHISTPROCESSAMENTONF', 'FRMHISTPROCESSAMENTONF')
  consultar(@Query(new ZodValidationPipe(histProcNfConsultaSchema)) q: HistProcNfConsultaDto) {
    return this.svc.consultar(q);
  }
}
