import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { produtosRelSchema, type ProdutosRelDto } from '@apollo/shared';
import { ProdutosRel2Service, type TipoProdutosRel2 } from './produtos-rel-2.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** RELATÓRIOS DE PRODUTOS (`FRMPRODUTOSREL`): os treze relatórios vivos do combo num serviço só. RBAC: gate de tela. */
@Controller('relatorios/produtos')
@UseGuards(AcessoGuard)
export class ProdutosRelController {
  constructor(private readonly svc2: ProdutosRel2Service) {}

  @Get()
  @RequerAcesso('FRMPRODUTOSREL', 'FRMPRODUTOSREL')
  gerar(@Query(new ZodValidationPipe(produtosRelSchema)) q: ProdutosRelDto) {
    return this.svc2.gerar({
      tipo: q.tipo as TipoProdutosRel2, empresas: q.empresas ?? null, produto: q.produto ?? null,
      coddpto: q.coddpto ?? null, codgrupo: q.codgrupo ?? null, codsubgrupo: q.codsubgrupo ?? null, codsecao: q.codsecao ?? null,
      codfor: q.codfor ?? null, ativo: q.ativo ?? null, ativoModo: q.ativoModo ?? null, filtroEstoque: q.filtroEstoque ?? null,
      filtroEstoqueDep: q.filtroEstoqueDep ?? null, disponivelEm: q.disponivelEm ?? null,
      estoqueEm: q.estoqueEm ?? null, estoqueSinal: q.estoqueSinal ?? null, estoqueQtde: q.estoqueQtde ?? null,
      local: q.local ?? null, lotes: q.lotes ?? null, dataIni: q.dataIni ?? null, dataFim: q.dataFim ?? null,
    });
  }
}
