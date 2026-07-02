import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DreService } from './dre.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * DRE CONTÁBIL (relatório) — corte-1. Endpoint de LEITURA/agregação (não-CRUD): calcula a DRE do
 * período/empresa a partir do DIÁRIO + estrutura semeada. Path `cadastro/dre`. RBAC FRMDRE.
 */
@Controller('cadastro/dre')
@UseGuards(AcessoGuard)
export class DreController {
  constructor(private readonly svc: DreService) {}

  @Get()
  @RequerAcesso('FRMDRE', 'BTNVISUALIZAR')
  calcular(@Query() q: Record<string, string>) {
    return this.svc.calcular(q.dataInicio, q.dataFim);
  }
}
