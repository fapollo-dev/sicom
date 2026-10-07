import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AcessoGuard } from '../acesso/acesso.guard';
import { PesquisaService, type ParametrosDaPesquisa } from './pesquisa.service';

/**
 * A Pesquisa (frmPesquisa) de qualquer cadastro: `GET /cadastro/pesquisa/meta?recurso=cadastro/produtos` (os campos, as operações e a
 * abertura) e `GET /cadastro/pesquisa?recurso=…&campo=…&operacao=…&valor=…&pagina=…` (as linhas e o total). Leitura, como a listagem
 * dos cadastros: basta estar autenticado; os filtros obrigatórios da tela (lojas do operador etc.) recortam o resultado.
 */
@Controller('cadastro/pesquisa')
@UseGuards(AcessoGuard)
export class PesquisaController {
  constructor(private readonly pesquisa: PesquisaService) {}

  @Get('meta')
  meta(@Query('recurso') recurso: string) {
    return this.pesquisa.meta(recurso);
  }

  @Get()
  pesquisar(@Query() q: Record<string, string>) {
    const t = this.pesquisa.tela(q.recurso);
    const extras: Record<string, string> = {};
    for (const k of t.extras ?? []) if (q[k] != null) extras[k] = q[k];
    const p: ParametrosDaPesquisa = {
      campo: q.campo || undefined,
      operacao: q.operacao || undefined,
      valor: q.valor,
      valor2: q.valor2,
      situacao: q.situacao === 'inativos' || q.situacao === 'todos' ? q.situacao : 'ativos',
      opcao: q.opcao || undefined,
      ordenacao: q.ordenacao || undefined,
      ordemDesc: q.ordemDesc === 'true',
      pagina: q.pagina ? Number(q.pagina) : 0,
      porPagina: q.porPagina ? Number(q.porPagina) : undefined,
      empresas: q.empresas ? q.empresas.split(',').map(Number).filter(Number.isInteger) : undefined,
      extras,
      soCodigos: q.soCodigos === 'true',
    };
    return this.pesquisa.pesquisar(q.recurso, p);
  }
}
