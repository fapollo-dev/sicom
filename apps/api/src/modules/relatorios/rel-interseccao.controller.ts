import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relInterseccaoSchema, type RelInterseccaoDto } from '@apollo/shared';
import { RelInterseccaoService } from './rel-interseccao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** INTERSECÇÃO DE PRODUTOS (`FRMRELINTERSECCAOPRODUTOS`) — RBAC: gate de tela. */
@Controller('relatorios/interseccao-produtos')
@UseGuards(AcessoGuard)
export class RelInterseccaoController {
  constructor(private readonly svc: RelInterseccaoService) {}

  @Get()
  @RequerAcesso('FRMRELINTERSECCAOPRODUTOS', 'FRMRELINTERSECCAOPRODUTOS')
  gerar(@Query(new ZodValidationPipe(relInterseccaoSchema)) q: RelInterseccaoDto) {
    return this.svc.gerar({
      idproduto: q.idproduto, dataIni: q.dataIni, dataFim: q.dataFim,
      ordenarPor: q.ordenarPor ?? null, limite: q.limite ?? null,
    });
  }
}
