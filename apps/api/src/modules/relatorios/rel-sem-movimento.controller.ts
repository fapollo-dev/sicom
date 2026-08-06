import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relSemMovimentoSchema, type RelSemMovimentoDto } from '@apollo/shared';
import { RelSemMovimentoService } from './rel-sem-movimento.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** PRODUTOS SEM MOVIMENTO (rel 13 do hub). RBAC: o mesmo gate do hub — já semeado na mig 130. */
@Controller('relatorios/sem-movimento')
@UseGuards(AcessoGuard)
export class RelSemMovimentoController {
  constructor(private readonly svc: RelSemMovimentoService) {}

  @Post('consultar')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  consultar(@Body(new ZodValidationPipe(relSemMovimentoSchema)) dto: RelSemMovimentoDto) {
    return this.svc.consultar(dto);
  }
}
