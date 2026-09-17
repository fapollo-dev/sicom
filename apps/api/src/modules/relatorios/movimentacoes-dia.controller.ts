import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { movimentacoesDiaSchema, type MovimentacoesDiaDto } from '@apollo/shared';
import { MovimentacoesDiaService } from './movimentacoes-dia.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** MOVIMENTAÇÕES DO DIA (`FRMMOVIMENTACOESDIA`) — RBAC: gate de tela. */
@Controller('relatorios/movimentacoes-dia')
@UseGuards(AcessoGuard)
export class MovimentacoesDiaController {
  constructor(private readonly svc: MovimentacoesDiaService) {}

  @Get()
  @RequerAcesso('FRMMOVIMENTACOESDIA', 'FRMMOVIMENTACOESDIA')
  gerar(@Query(new ZodValidationPipe(movimentacoesDiaSchema)) q: MovimentacoesDiaDto) {
    return this.svc.gerar(q);
  }
}
