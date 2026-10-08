import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { etiquetaAdicionarSchema, etiquetaImprimirSchema, etiquetaDeItensSchema, type EtiquetaAdicionarDto, type EtiquetaImprimirDto, type EtiquetaDeItensDto } from '@apollo/shared';
import { EtiquetaService } from './etiqueta.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso, RequerAcessoDeAlgum } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * ETIQUETAS DE PREÇO (FRMETIQUETA) — fila do coletor + busca por codbarra + imprimir (log + marca + layout).
 * RBAC fiel aos botões com Tag 1 do Uetiqueta.dfm (legenda na PERMISSOES da produção): a fila do coletor é o
 * "Consulta Preço" (`BTNCONSULTAPRECO` — "Adicionar registro de etiquetas enviadas pelo coletor"); a pesquisa de
 * produtos por ETQ_IMPRESSA é o "Adicionar Itens" (`BTNADICIONARREGISTRO`). Imprimir, tirar da lista e o resto não têm
 * componente com Tag 1 (TfrmMaster) — o legado libera para quem abre a tela.
 */
@Controller('cadastro/etiqueta')
@UseGuards(AcessoGuard)
export class EtiquetaController {
  constructor(private readonly svc: EtiquetaService) {}

  /** fila de pendentes (IMPRESSA='N') da empresa, com o conteúdo da etiqueta computado. */
  @Get('fila')
  @RequerAcesso('FRMETIQUETA', 'BTNCONSULTAPRECO')
  fila(@Query('ativos') ativos?: string) {
    return this.svc.fila({ ativos: ativos !== 'N' });
  }

  /** os modelos de etiqueta (os .fr3 `eti$` da RELATORIOS) — o combo "Modelo da etiqueta" */
  @Get('modelos')
  @RequerAcessoDeAlgum(['FRMETIQUETA', 'FRMETIQUETA'], ['FRMCADAGENDAPROMOCAO', 'FRMCADAGENDAPROMOCAO'], ['FRMAJUSTEPRECOS', 'FRMAJUSTEPRECOS'], ['FRMCADPRODUTO', 'FRMCADPRODUTO'], ['FRMPRECIFICACAONF', 'FRMPRECIFICACAONF'], ['FRMPRECIFICACAONFBRUTA', 'FRMPRECIFICACAONFBRUTA'], ['FRMRELPRECOSALTERADOS', 'FRMRELPRECOSALTERADOS'], ['FRMNF', 'FRMNF'])
  modelos() {
    return this.svc.modelos();
  }

  /** resolve/preview um produto por codbarra (ou id) — p/ o add manual/scan. */
  /** as etiquetas dos lotes marcados no Ajuste de Preços (o botão "Etiquetas"), expandidas pelo grupo de preço */
  @Post('dos-lotes')
  @HttpCode(200)
  // o Ajuste de Preços abre a tela de etiquetas por Create (uAjustePrecos.pas:123), sem o gate do menu
  @RequerAcessoDeAlgum(['FRMETIQUETA', 'FRMETIQUETA'], ['FRMAJUSTEPRECOS', 'FRMAJUSTEPRECOS'])
  dosLotes(@Body() body: { codlotes?: number[]; semPromocao?: boolean }) {
    return this.svc.dosLotes(Array.isArray(body?.codlotes) ? body.codlotes : [], !!body?.semPromocao);
  }

  /** as etiquetas da agenda de promoção (o botão "Etiquetas" da agenda, que abre a tela de etiquetas sem o gate dela) */
  @Post('da-agenda')
  @HttpCode(200)
  @RequerAcesso('FRMCADAGENDAPROMOCAO', 'FRMCADAGENDAPROMOCAO')
  daAgenda(@Body() body: { codagenda?: unknown; preco?: unknown }) {
    const cod = Number(body?.codagenda);
    if (!Number.isInteger(cod) || cod <= 0) throw new BusinessRuleError('AGENDA_NAO_ENCONTRADA', { codagenda: body?.codagenda });
    const preco = body?.preco === 'venda' || body?.preco === 'promocional' ? body.preco : 'status';
    return this.svc.daAgenda(cod, preco);
  }

  /** importar arquivo: os códigos das linhas "CODBARRA/QTDE/VALOR" do .txt (o navegador lê o arquivo) */
  @Post('importar')
  @HttpCode(200)
  @RequerAcesso('FRMETIQUETA', 'FRMETIQUETA')
  importar(@Body() body: { codigos?: unknown }) {
    return this.svc.importar(Array.isArray(body?.codigos) ? body.codigos.map((c) => String(c)) : []);
  }

  /** as telas que abrem as etiquetas com a lista pronta (o legado as abre por Create, sem o gate da tela de etiquetas) */
  @Post('de-itens')
  @HttpCode(200)
  @RequerAcessoDeAlgum(['FRMETIQUETA', 'FRMETIQUETA'], ['FRMCADPRODUTO', 'FRMCADPRODUTO'], ['FRMPRECIFICACAONF', 'FRMPRECIFICACAONF'], ['FRMPRECIFICACAONFBRUTA', 'FRMPRECIFICACAONFBRUTA'], ['FRMRELPRECOSALTERADOS', 'FRMRELPRECOSALTERADOS'], ['FRMNF', 'FRMNF'])
  deItens(@Body(new ZodValidationPipe(etiquetaDeItensSchema)) body: EtiquetaDeItensDto) {
    return this.svc.deItens(body);
  }

  @Get('produto')
  @RequerAcesso('FRMETIQUETA', 'FRMETIQUETA')
  produto(@Query('codbarra') codbarra?: string, @Query('idproduto') idproduto?: string, @Query('ativos') ativos?: string) {
    return this.svc.buscarProduto(idproduto ? Number(idproduto) : undefined, codbarra, ativos !== 'N');
  }

  /** enfileira um produto (por id ou codbarra). */
  @Post('adicionar')
  @HttpCode(200)
  @RequerAcesso('FRMETIQUETA', 'BTNADICIONARREGISTRO')
  adicionar(@Body(new ZodValidationPipe(etiquetaAdicionarSchema)) body: EtiquetaAdicionarDto) {
    return this.svc.adicionar({ idproduto: body.idproduto, codbarra: body.codbarra });
  }

  /** remove um item da fila. */
  @Delete(':id')
  @RequerAcesso('FRMETIQUETA', 'FRMETIQUETA')
  remover(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remover(id);
  }

  /** imprime: registros de impressão por modelo + log + marcas, e o .fr3 de cada modelo p/ o navegador desenhar. */
  @Post('imprimir')
  @HttpCode(200)
  // quem chega por outra tela (agenda, Ajuste de Preços, cadastro de produto, Precificação NF, preços alterados, NF) imprime sem o gate da tela de etiquetas (o legado a abre por Create)
  @RequerAcessoDeAlgum(['FRMETIQUETA', 'FRMETIQUETA'], ['FRMCADAGENDAPROMOCAO', 'FRMCADAGENDAPROMOCAO'], ['FRMAJUSTEPRECOS', 'FRMAJUSTEPRECOS'], ['FRMCADPRODUTO', 'FRMCADPRODUTO'], ['FRMPRECIFICACAONF', 'FRMPRECIFICACAONF'], ['FRMPRECIFICACAONFBRUTA', 'FRMPRECIFICACAONFBRUTA'], ['FRMRELPRECOSALTERADOS', 'FRMRELPRECOSALTERADOS'], ['FRMNF', 'FRMNF'])
  imprimir(@Body(new ZodValidationPipe(etiquetaImprimirSchema)) body: EtiquetaImprimirDto) {
    return this.svc.imprimir(body);
  }
}
