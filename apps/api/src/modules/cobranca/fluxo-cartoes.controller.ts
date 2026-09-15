import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { fluxoCartoesSchema, type FluxoCartoesDto } from '@apollo/shared';
import { FluxoCartoesService } from './fluxo-cartoes.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** FLUXO DE CARTÕES (`FRMFLUXOCARTOES`) — RBAC: gate de tela. */
@Controller('cobranca/fluxo-cartoes')
@UseGuards(AcessoGuard)
export class FluxoCartoesController {
  constructor(private readonly svc: FluxoCartoesService) {}

  @Get()
  @RequerAcesso('FRMFLUXOCARTOES', 'FRMFLUXOCARTOES')
  porDia(@Query(new ZodValidationPipe(fluxoCartoesSchema)) q: FluxoCartoesDto) {
    return this.svc.porDia({ dataIni: q.dataIni, dataFim: q.dataFim, codoperadora: q.codoperadora ?? null });
  }

  /** o detalhe de um dia, por operadora — o duplo clique na linha. */
  @Get('dia')
  @RequerAcesso('FRMFLUXOCARTOES', 'FRMFLUXOCARTOES')
  porOperadora(@Query('data') data: string) {
    return this.svc.porOperadora(String(data ?? ''));
  }
}
