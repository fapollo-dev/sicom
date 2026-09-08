import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { salvarRelatorioSchema, executarRelatorioSchema, type SalvarRelatorioDto, type ExecutarRelatorioDto } from '@apollo/shared';
import { RelatorioConstrutorService } from './relatorio-construtor.service';
import { RelatorioImportadorService } from './relatorio-importador.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CONSTRUTOR DE RELATÓRIOS (`FRMRELATORIO` + `FRMCADASTRORELATORIO`).
 *
 * O legado separa os dois gates e o cliente usa a separação: **rodar** um relatório tem 1.251 acessos,
 * **cadastrar** tem 73. Quem executa não precisa poder criar.
 */
@Controller('relatorios/construtor')
@UseGuards(AcessoGuard)
export class RelatorioConstrutorController {
  constructor(
    private readonly svc: RelatorioConstrutorService,
    private readonly importador: RelatorioImportadorService,
  ) {}

  /** o catálogo de fontes — as views que têm rótulo. */
  @Get('fontes')
  @RequerAcesso('FRMCADASTRORELATORIO', 'FRMCADASTRORELATORIO')
  fontes() {
    return this.svc.fontes();
  }

  @Get('fontes/:fonte/campos')
  @RequerAcesso('FRMCADASTRORELATORIO', 'FRMCADASTRORELATORIO')
  campos(@Param('fonte') fonte: string) {
    return this.svc.campos(fonte);
  }

  @Get()
  @RequerAcesso('FRMRELATORIO', 'FRMRELATORIO')
  listar() {
    return this.svc.listar();
  }

  @Get(':cod')
  @RequerAcesso('FRMRELATORIO', 'FRMRELATORIO')
  obter(@Param('cod', ParseIntPipe) cod: number) {
    return this.svc.obter(cod);
  }

  @Post()
  @HttpCode(200)
  @RequerAcesso('FRMCADASTRORELATORIO', 'FRMCADASTRORELATORIO')
  salvar(@Body(new ZodValidationPipe(salvarRelatorioSchema)) body: SalvarRelatorioDto) {
    return this.svc.salvar({ codrelatoriodef: body.codrelatoriodef ?? null, nome: body.nome, fonte: body.fonte, definicao: body.definicao });
  }

  @Delete(':cod')
  @HttpCode(204)
  @RequerAcesso('FRMCADASTRORELATORIO', 'FRMCADASTRORELATORIO')
  async remover(@Param('cod', ParseIntPipe) cod: number) {
    await this.svc.remover(cod);
  }

  @Post('executar')
  @HttpCode(200)
  @RequerAcesso('FRMRELATORIO', 'FRMRELATORIO')
  executar(@Body(new ZodValidationPipe(executarRelatorioSchema)) body: ExecutarRelatorioDto) {
    return this.svc.executar(body as never);
  }

  /** o CSV que o legado exporta (`BtnExportaCSVClick`), em `;` e vírgula decimal para o Excel pt-BR. */
  @Post('csv')
  @HttpCode(200)
  @RequerAcesso('FRMRELATORIO', 'FRMRELATORIO')
  async csv(@Body(new ZodValidationPipe(executarRelatorioSchema)) body: ExecutarRelatorioDto, @Res() res: Response) {
    const r = await this.svc.csv(body as never);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(r.nome)}"`);
    res.send(r.conteudo);
  }

  /**
   * Importa os relatórios que o cliente montou no legado (`relatorios_customizados`, que a carga traz).
   * Idempotente: o que já veio é pulado, então rodar de novo depois de portar uma view só traz o que passou
   * a ser possível. O que não deu é devolvido em `pendentes`, com o motivo.
   */
  @Post('importar')
  @HttpCode(200)
  @RequerAcesso('FRMCADASTRORELATORIO', 'FRMCADASTRORELATORIO')
  importar(@Body() body: { substituir?: boolean }) {
    return this.importador.importar({ substituir: !!body?.substituir });
  }

  /** os campos de uma fonte, pela query (usado quando a tela já sabe a fonte do relatório salvo). */
  @Get('campos/lista')
  @RequerAcesso('FRMRELATORIO', 'FRMRELATORIO')
  camposQuery(@Query('fonte') fonte: string) {
    return this.svc.campos(String(fonte ?? ''));
  }
}
