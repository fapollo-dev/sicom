import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { produtosRelSchema, type ProdutosRelDto } from '@apollo/shared';
import { ProdutosRelService } from './produtos-rel.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** RELATÓRIOS DE PRODUTOS (`FRMPRODUTOSREL`) — corte-1: os três do núcleo de estoque. RBAC: gate de tela. */
@Controller('relatorios/produtos')
@UseGuards(AcessoGuard)
export class ProdutosRelController {
  constructor(private readonly svc: ProdutosRelService) {}

  @Get()
  @RequerAcesso('FRMPRODUTOSREL', 'FRMPRODUTOSREL')
  gerar(@Query(new ZodValidationPipe(produtosRelSchema)) q: ProdutosRelDto) {
    return this.svc.gerar({
      tipo: q.tipo, filtroEstoque: q.filtroEstoque ?? null, ativo: q.ativo ?? null,
      coddpto: q.coddpto ?? null, codgrupo: q.codgrupo ?? null, codsubgrupo: q.codsubgrupo ?? null,
      codsecao: q.codsecao ?? null, codfor: q.codfor ?? null, produto: q.produto ?? null,
      diasSemVenda: q.diasSemVenda ?? null,
      dataIni: q.dataIni ?? null, dataFim: q.dataFim ?? null,
    });
  }
}
