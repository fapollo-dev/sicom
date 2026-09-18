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
}
