import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { nfEsteiraConsultaSchema, type NfEsteiraConsultaDto } from '@apollo/shared';
import { NfEsteiraService } from './nf-esteira.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** A ESTEIRA DA NOTA — as dez etapas do manifesto à devolução (mig 292). Só leitura. */
@Controller('cadastro/nf-esteira')
@UseGuards(AcessoGuard)
export class NfEsteiraController {
  constructor(private readonly svc: NfEsteiraService) {}

  @Get() @RequerAcesso('FRMNFSTATUSPROCESSO', 'FRMNFSTATUSPROCESSO')
  consultar(@Query(new ZodValidationPipe(nfEsteiraConsultaSchema)) q: NfEsteiraConsultaDto) {
    return this.svc.consultar(q);
  }
}
