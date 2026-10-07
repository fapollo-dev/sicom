import { Body, Controller, Delete, Get, HttpCode, Put, Query, UseGuards } from '@nestjs/common';
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

  /** o status da tela (Ctrl+Shift+S/D da Pesquisa — CONFIG_STATUS_TELA): o campo, a operação e o valor com que ela reabre */
  @Get('status')
  lerStatus(@Query('recurso') recurso: string) {
    return this.pesquisa.lerStatus(recurso);
  }

  @Put('status')
  @HttpCode(204)
  salvarStatus(@Query('recurso') recurso: string, @Body() b: { campo?: string; operacao?: string; valor?: string; valor2?: string; soma?: string | null }) {
    return this.pesquisa.salvarStatus(recurso, {
      campo: String(b?.campo ?? ''), operacao: (b?.operacao ?? 'igual') as never, valor: String(b?.valor ?? ''), valor2: String(b?.valor2 ?? ''), soma: b?.soma ?? null,
    });
  }

  @Delete('status')
  @HttpCode(204)
  apagarStatus(@Query('recurso') recurso: string) {
    return this.pesquisa.apagarStatus(recurso);
  }

  @Get('detalhe')
  detalhe(@Query('recurso') recurso: string, @Query('tecla') tecla: string, @Query('codigo') codigo: string) {
    return this.pesquisa.detalhe(recurso, tecla, Number(codigo));
  }

  /** `opcao`/`complemento` (opcionais): os campos da relação da escolha da janela — o A pagar troca de view (GET_APAGAR/GET_CP/_CEN) */
  @Get('meta')
  meta(@Query('recurso') recurso: string, @Query('opcao') opcao?: string, @Query('complemento') complemento?: string) {
    return this.pesquisa.meta(recurso, { opcao: opcao || undefined, complemento: complemento || undefined });
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
      complemento: q.complemento || undefined,
      ordenacao: q.ordenacao || undefined,
      ordemDesc: q.ordemDesc === 'true',
      pagina: q.pagina ? Number(q.pagina) : 0,
      porPagina: q.porPagina ? Number(q.porPagina) : undefined,
      empresas: q.empresas ? q.empresas.split(',').map(Number).filter(Number.isInteger) : undefined,
      extras,
      soCodigos: q.soCodigos === 'true',
      soma: q.soma || undefined,
      fixos: Object.fromEntries(Object.entries(q).filter(([k]) => k.startsWith('f_') && k.length > 2).map(([k, v]) => [k.slice(2), String(v)])),
    };
    return this.pesquisa.pesquisar(q.recurso, p);
  }
}
