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
    return this.svc.gerar(this.filtro(q));
  }

  /** o "Pesquisar" do legado imprime: os dois layouts do cliente pelo tipo de análise */
  @Get('impressao')
  @RequerAcesso('FRMRELINTERSECCAOPRODUTOS', 'FRMRELINTERSECCAOPRODUTOS')
  impressao(@Query(new ZodValidationPipe(relInterseccaoSchema)) q: RelInterseccaoDto) {
    return this.svc.impressao(this.filtro(q));
  }

  private filtro(q: RelInterseccaoDto) {
    return {
      idproduto: q.idproduto, dataIni: q.dataIni, dataFim: q.dataFim, ordenarPor: q.ordenarPor ?? null, limite: q.limite ?? null,
      empresas: q.empresas ? q.empresas.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) : null,
    };
  }
}
