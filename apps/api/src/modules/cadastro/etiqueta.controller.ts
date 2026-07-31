import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { etiquetaAdicionarSchema, etiquetaImprimirSchema, type EtiquetaAdicionarDto, type EtiquetaImprimirDto } from '@apollo/shared';
import { EtiquetaService } from './etiqueta.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * ETIQUETAS DE PREÇO (FRMETIQUETA) — fila do coletor + busca por codbarra + imprimir (log + marca + layout).
 */
@Controller('cadastro/etiqueta')
@UseGuards(AcessoGuard)
export class EtiquetaController {
  constructor(private readonly svc: EtiquetaService) {}

  /** fila de pendentes (IMPRESSA='N') da empresa, com o conteúdo da etiqueta computado. */
  @Get('fila')
  @RequerAcesso('FRMETIQUETA', 'BTNGRAVAR')
  fila() {
    return this.svc.fila();
  }

  /** resolve/preview um produto por codbarra (ou id) — p/ o add manual/scan. */
  @Get('produto')
  @RequerAcesso('FRMETIQUETA', 'BTNGRAVAR')
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
  @RequerAcesso('FRMETIQUETA', 'BTNEXCLUIR')
  remover(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remover(id);
  }

  /** imprime: grava log + marca IMPRESSA='S' + devolve as etiquetas p/ o layout imprimível. */
  @Post('imprimir')
  @HttpCode(200)
  @RequerAcesso('FRMETIQUETA', 'BTNGRAVAR')
  imprimir(@Body(new ZodValidationPipe(etiquetaImprimirSchema)) body: EtiquetaImprimirDto) {
    return this.svc.imprimir({ itens: body.itens });
  }
}
