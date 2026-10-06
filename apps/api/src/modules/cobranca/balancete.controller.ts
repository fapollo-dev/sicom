import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { balanceteSchema, type BalanceteDto } from '@apollo/shared';
import { BalanceteService } from './balancete.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** BALANCETE DE VERIFICAÇÃO (`FRMRELBALANCETE`) — gate de tela. */
@Controller('contabil/balancete')
@UseGuards(AcessoGuard)
export class BalanceteController {
  constructor(private readonly svc: BalanceteService) {}
  @Get() @RequerAcesso('FRMRELBALANCETE', 'FRMRELBALANCETE') gerar(@Query(new ZodValidationPipe(balanceteSchema)) q: BalanceteDto) { return this.svc.gerar(q); }
  /** o Imprimir (BalanceteVerificacao.fr3) — a PERMISSOES da produção não tem BTNIMPRIMIR para esta tela: vale o acesso a ela */
  @Get('impressao') @RequerAcesso('FRMRELBALANCETE', 'FRMRELBALANCETE') impressao(@Query(new ZodValidationPipe(balanceteSchema)) q: BalanceteDto) { return this.svc.impressao(q); }
}
