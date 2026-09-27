import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { produtosRelSchema, type ProdutosRelDto } from '@apollo/shared';
import { ProdutosRelService } from './produtos-rel.service';
import { ProdutosRel2Service, TIPOS_PRODUTOS_REL_2, type TipoProdutosRel2 } from './produtos-rel-2.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** RELATÓRIOS DE PRODUTOS (`FRMPRODUTOSREL`) — corte-1 (núcleo de estoque) e corte-2 (os oito vivos). RBAC: gate de tela. */
@Controller('relatorios/produtos')
@UseGuards(AcessoGuard)
export class ProdutosRelController {
  constructor(
    private readonly svc: ProdutosRelService,
    private readonly svc2: ProdutosRel2Service,
  ) {}

  @Get()
  @RequerAcesso('FRMPRODUTOSREL', 'FRMPRODUTOSREL')
  gerar(@Query(new ZodValidationPipe(produtosRelSchema)) q: ProdutosRelDto) {
    if ((TIPOS_PRODUTOS_REL_2 as readonly string[]).includes(q.tipo)) {
      return this.svc2.gerar({
        tipo: q.tipo as TipoProdutosRel2, empresas: q.empresas ?? null, produto: q.produto ?? null,
        coddpto: q.coddpto ?? null, codgrupo: q.codgrupo ?? null, codsubgrupo: q.codsubgrupo ?? null, codsecao: q.codsecao ?? null,
        codfor: q.codfor ?? null, ativo: q.ativo ?? null, ativoModo: q.ativoModo ?? null, filtroEstoque: q.filtroEstoque ?? null,
        estoqueEm: q.estoqueEm ?? null, estoqueSinal: q.estoqueSinal ?? null, estoqueQtde: q.estoqueQtde ?? null,
        local: q.local ?? null, lotes: q.lotes ?? null, dataIni: q.dataIni ?? null, dataFim: q.dataFim ?? null,
      });
    }
    return this.svc.gerar({
      tipo: q.tipo as 'ESTOQUE_ATUAL' | 'RUPTURA' | 'ANALISE' | 'ALTERACOES_PRECO', filtroEstoque: q.filtroEstoque ?? null, ativo: q.ativo ?? null, ativoModo: q.ativoModo ?? null,
      coddpto: q.coddpto ?? null, codgrupo: q.codgrupo ?? null, codsubgrupo: q.codsubgrupo ?? null,
      codsecao: q.codsecao ?? null, codfor: q.codfor ?? null, produto: q.produto ?? null,
      diasSemVenda: q.diasSemVenda ?? null,
      dataIni: q.dataIni ?? null, dataFim: q.dataFim ?? null,
    });
  }
}
