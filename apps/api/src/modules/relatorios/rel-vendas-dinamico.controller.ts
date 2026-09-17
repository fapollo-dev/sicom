import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relVendasDinamicoSchema, type RelVendasDinamicoDto } from '@apollo/shared';
import { RelVendasDinamicoService } from './rel-vendas-dinamico.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** ANÁLISE DE VENDAS DE PRODUTOS (`FRMRELATORIOVENDASDINAMICO`) — RBAC: gate de tela. */
@Controller('relatorios/vendas-dinamico')
@UseGuards(AcessoGuard)
export class RelVendasDinamicoController {
  constructor(private readonly svc: RelVendasDinamicoService) {}

  @Get()
  @RequerAcesso('FRMRELATORIOVENDASDINAMICO', 'FRMRELATORIOVENDASDINAMICO')
  gerar(@Query(new ZodValidationPipe(relVendasDinamicoSchema)) q: RelVendasDinamicoDto) {
    return this.svc.gerar(q);
  }
}
