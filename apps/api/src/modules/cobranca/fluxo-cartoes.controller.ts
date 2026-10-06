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
    return this.svc.porDia(this.filtro(q));
  }

  /** o detalhe de um dia, por operadora — o Enter na linha. */
  @Get('dia')
  @RequerAcesso('FRMFLUXOCARTOES', 'FRMFLUXOCARTOES')
  porOperadora(@Query('data') data: string, @Query('empresas') empresas?: string) {
    return this.svc.porOperadora(String(data ?? ''), lojas(empresas));
  }

  /** o Imprimir no layout do cliente (Rel_Fluxo_Cartoes.fr3) */
  @Get('impressao')
  @RequerAcesso('FRMFLUXOCARTOES', 'FRMFLUXOCARTOES')
  impressao(@Query(new ZodValidationPipe(fluxoCartoesSchema)) q: FluxoCartoesDto) {
    return this.svc.impressao(this.filtro(q));
  }

  private filtro(q: FluxoCartoesDto) {
    return { dataIni: q.dataIni, dataFim: q.dataFim, codoperadora: q.codoperadora ?? null, empresas: lojas(q.empresas) };
  }
}

const lojas = (s?: string | null) => (s && /^[\d,\s]+$/.test(s) ? s.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) : null);
