import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { importarProdutosInventarioSchema, aplicarInventarioSchema, type ImportarProdutosInventarioDto, type AplicarInventarioDto } from '@apollo/shared';
import { InventarioService } from './inventario.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * INVENTÁRIO (FRMINVENTARIO — uInventario) — ações verticais: importar-produtos (popular a folha), diferenças
 * (calculada) e aplicar-ao-estoque (sobrescreve estoque.qtde = contado, gated por senha ADM/E7). Convive no
 * caminho `cadastro/inventario` do agregado (CRUD do livro+itens) — rotas distintas por método+path.
 */
@Controller('cadastro/inventario')
@UseGuards(AcessoGuard)
export class InventarioController {
  constructor(private readonly svc: InventarioService) {}

  /** popula a folha de contagem a partir de PRODUTOS (filtros ativo/com-saldo). */
  @Post(':id/importar-produtos')
  @HttpCode(200)
  @RequerAcesso('FRMINVENTARIO', 'BTNIMPORTARPRODUTOS')
  importarProdutos(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(importarProdutosInventarioSchema)) body: ImportarProdutosInventarioDto,
  ) {
    return this.svc.importarProdutos(id, { apenasAtivos: body.apenasAtivos, apenasComSaldo: body.apenasComSaldo });
  }

  /** diferenças (contado × saldo de sistema) — calculada, read-only. */
  @Get(':id/diferencas')
  @RequerAcesso('FRMINVENTARIO', 'BTNGRAVAR')
  diferencas(@Param('id', ParseIntPipe) id: number) {
    return this.svc.diferencas(id);
  }

  /** APLICA ao estoque (sobrescreve = contado). Gated por senha de operação ADM da empresa (E7). */
  @Post(':id/aplicar')
  @HttpCode(200)
  @RequerAcesso('FRMINVENTARIO', 'BTNAPLICARESTOQUE')
  aplicar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(aplicarInventarioSchema)) body: AplicarInventarioDto,
  ) {
    return this.svc.aplicar(id, { senhaOperacao: body.senhaOperacao });
  }
}
