import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { etiquetaAdicionarSchema, etiquetaImprimirSchema, type EtiquetaAdicionarDto, type EtiquetaImprimirDto } from '@apollo/shared';
import { EtiquetaService } from './etiqueta.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

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
  fila() {
    return this.svc.fila();
  }

  /** resolve/preview um produto por codbarra (ou id) — p/ o add manual/scan. */
  /** a pesquisa por ETQ_IMPRESSA — 'N' (padrão) = preço alterado com etiqueta velha, 'S' = já impressa, 'T' = todos */
  @Get('pesquisa')
  @RequerAcesso('FRMETIQUETA', 'BTNADICIONARREGISTRO')
  pesquisar(@Query('situacao') situacao?: string, @Query('busca') busca?: string, @Query('limite') limite?: string) {
    const sit = situacao === 'S' || situacao === 'T' ? situacao : 'N';
    return this.svc.pesquisar({ situacao: sit, busca, limite: limite ? Number(limite) : undefined });
  }

  /** as etiquetas dos lotes marcados no Ajuste de Preços (o botão "Etiquetas"), expandidas pelo grupo de preço */
  @Post('dos-lotes')
  @HttpCode(200)
  @RequerAcesso('FRMETIQUETA', 'FRMETIQUETA')
  dosLotes(@Body() body: { codlotes?: number[]; semPromocao?: boolean }) {
    return this.svc.dosLotes(Array.isArray(body?.codlotes) ? body.codlotes : [], !!body?.semPromocao);
  }

  @Get('produto')
  @RequerAcesso('FRMETIQUETA', 'FRMETIQUETA')
  produto(@Query('codbarra') codbarra?: string, @Query('idproduto') idproduto?: string) {
    return this.svc.buscarProduto(idproduto ? Number(idproduto) : undefined, codbarra);
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

  /** imprime: grava log + marca IMPRESSA='S' + devolve as etiquetas p/ o layout imprimível. */
  @Post('imprimir')
  @HttpCode(200)
  @RequerAcesso('FRMETIQUETA', 'FRMETIQUETA')
  imprimir(@Body(new ZodValidationPipe(etiquetaImprimirSchema)) body: EtiquetaImprimirDto) {
    return this.svc.imprimir({ itens: body.itens });
  }
}
