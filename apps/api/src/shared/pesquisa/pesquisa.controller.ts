import { Body, Controller, Delete, Get, HttpCode, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AcessoGuard } from '../acesso/acesso.guard';
import { RequerAcesso } from '../acesso/requer-acesso.decorator';
import { BusinessRuleError } from '../errors/app-error';
import { PesquisaService, type Escolha, type ParametrosDaPesquisa } from './pesquisa.service';

const escolhaDe = (opcao?: string, complemento?: string): Escolha => ({ opcao: opcao || undefined, complemento: complemento || undefined });

/**
 * A Pesquisa (frmPesquisa) de qualquer cadastro: `GET /cadastro/pesquisa/meta?recurso=cadastro/produtos` (os campos, as operações e a
 * abertura) e `GET /cadastro/pesquisa?recurso=…&campo=…&operacao=…&valor=…&pagina=…` (as linhas e o total). Leitura, como a listagem
 * dos cadastros: basta estar autenticado; os filtros obrigatórios da tela (lojas do operador etc.) recortam o resultado.
 */
@Controller('cadastro/pesquisa')
@UseGuards(AcessoGuard)
export class PesquisaController {
  constructor(private readonly pesquisa: PesquisaService) {}

  /**
   * o status da tela (Ctrl+Shift+S/D da Pesquisa — CONFIG_STATUS_TELA): o campo, a operação e o valor com que ela reabre. A chave é a
   * view aberta — no A pagar, a da opção e do complemento (`opcao`/`complemento`)
   */
  @Get('status')
  lerStatus(@Query('recurso') recurso: string, @Query('opcao') opcao?: string, @Query('complemento') complemento?: string) {
    return this.pesquisa.lerStatus(recurso, escolhaDe(opcao, complemento));
  }

  @Put('status')
  @HttpCode(204)
  salvarStatus(@Query('recurso') recurso: string, @Body() b: { campo?: string; operacao?: string; valor?: string; valor2?: string; soma?: string | null },
    @Query('opcao') opcao?: string, @Query('complemento') complemento?: string) {
    return this.pesquisa.salvarStatus(recurso, {
      campo: String(b?.campo ?? ''), operacao: (b?.operacao ?? 'igual') as never, valor: String(b?.valor ?? ''), valor2: String(b?.valor2 ?? ''), soma: b?.soma ?? null,
    }, escolhaDe(opcao, complemento));
  }

  @Delete('status')
  @HttpCode(204)
  apagarStatus(@Query('recurso') recurso: string, @Query('opcao') opcao?: string, @Query('complemento') complemento?: string) {
    return this.pesquisa.apagarStatus(recurso, escolhaDe(opcao, complemento));
  }

  @Get('detalhe')
  detalhe(@Query('recurso') recurso: string, @Query('tecla') tecla: string, @Query('codigo') codigo: string) {
    return this.pesquisa.detalhe(recurso, tecla, Number(codigo));
  }

  /** `opcao`/`complemento` (opcionais): os campos da relação da escolha da janela — o A pagar troca de view (GET_APAGAR/GET_CP/_CEN) */
  @Get('meta')
  meta(@Query('recurso') recurso: string, @Query('opcao') opcao?: string, @Query('complemento') complemento?: string) {
    return this.pesquisa.meta(recurso, escolhaDe(opcao, complemento));
  }

  /**
   * as "Configurações de impressão salvas" da view aberta e o &Imprimir com o filtro da pesquisa. O mesmo portão da impressão do
   * construtor (FRMRELATORIO · BTNIMPRIMIR): no legado o frmPesquisa cria o TfrmRelatorio sem passar pelo controle de permissões — atalho
   * de permissão que o Apollo não reproduz
   */
  @Get('relatorios')
  @RequerAcesso('FRMRELATORIO', 'BTNIMPRIMIR')
  relatorios(@Query('recurso') recurso: string, @Query('opcao') opcao?: string, @Query('complemento') complemento?: string) {
    return this.pesquisa.relatorios(recurso, escolhaDe(opcao, complemento));
  }

  /** a consulta vai na query (como a da grade); no corpo, o relatório e os códigos marcados */
  @Post('imprimir')
  @HttpCode(200)
  @RequerAcesso('FRMRELATORIO', 'BTNIMPRIMIR')
  imprimir(@Query() q: Record<string, string>, @Body() b: { codrelatoriodef?: number; marcados?: Array<string | number> }) {
    const cod = Number(b?.codrelatoriodef);
    if (!Number.isInteger(cod) || cod <= 0) throw new BusinessRuleError('RELATORIO_NAO_ENCONTRADO', { cod: b?.codrelatoriodef });
    const marcados = Array.isArray(b?.marcados) ? b.marcados.slice(0, 2001) : undefined;
    return this.pesquisa.imprimir(q.recurso, { ...this.parametros(q), codrelatoriodef: cod, marcados });
  }

  @Get()
  pesquisar(@Query() q: Record<string, string>) {
    return this.pesquisa.pesquisar(q.recurso, this.parametros(q));
  }

  /** a consulta da query: campo, operação, valor, situação, a escolha da janela, a página, os `f_<coluna>` e os parâmetros declarados */
  private parametros(q: Record<string, string>): ParametrosDaPesquisa {
    const t = this.pesquisa.tela(q.recurso);
    const extras: Record<string, string> = {};
    for (const k of t.extras ?? []) if (q[k] != null) extras[k] = q[k];
    return {
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
  }
}
