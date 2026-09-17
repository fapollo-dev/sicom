import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relAnaliseItensNfSchema, type RelAnaliseItensNfDto } from '@apollo/shared';
import { RelAnaliseItensNfService } from './rel-analise-itens-nf.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** ANÁLISE DE ITENS DA NOTA FISCAL (`FRMRELANALISEITENSNF`) — RBAC: gate de tela. */
@Controller('relatorios/analise-itens-nf')
@UseGuards(AcessoGuard)
export class RelAnaliseItensNfController {
  constructor(private readonly svc: RelAnaliseItensNfService) {}

  @Get()
  @RequerAcesso('FRMRELANALISEITENSNF', 'FRMRELANALISEITENSNF')
  gerar(@Query(new ZodValidationPipe(relAnaliseItensNfSchema)) q: RelAnaliseItensNfDto) {
    return this.svc.gerar(q);
  }
}
