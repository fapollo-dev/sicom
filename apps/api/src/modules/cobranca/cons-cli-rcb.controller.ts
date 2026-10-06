import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { consCliRcbSchema, type ConsCliRcbDto } from '@apollo/shared';
import { ConsCliRcbService } from './cons-cli-rcb.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CONSULTA A RECEBER POR CLIENTE (`FRMCONSCLIRCB`) — RBAC: gate de tela. */
@Controller('cobranca/cons-cli-rcb')
@UseGuards(AcessoGuard)
export class ConsCliRcbController {
  constructor(private readonly svc: ConsCliRcbService) {}

  @Get()
  @RequerAcesso('FRMCONSCLIRCB', 'FRMCONSCLIRCB')
  consultar(@Query(new ZodValidationPipe(consCliRcbSchema)) q: ConsCliRcbDto) {
    return this.svc.consultar(filtro(q));
  }

  /** o Imprimir dos marcados no layout do cliente (Rel_BaixaAReceber.fr3) */
  @Get('impressao')
  @RequerAcesso('FRMCONSCLIRCB', 'FRMCONSCLIRCB')
  impressao(@Query(new ZodValidationPipe(consCliRcbSchema)) q: ConsCliRcbDto) {
    return this.svc.impressao(filtro(q));
  }
}

const filtro = (q: ConsCliRcbDto) => ({
  codparceiro: q.codparceiro, taxa: q.taxa ?? null, juroAte: q.juroAte ?? null,
  selecionados: q.selecionados ? q.selecionados.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) : null,
});
