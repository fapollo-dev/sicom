import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import {
  importarProdutosInventarioSchema, aplicarInventarioSchema, gerarBalancoSchema, importarBalancoSchema,
  importarBalancoSincronizarSchema, sincronizarInventarioSchema,
  type ImportarProdutosInventarioDto, type AplicarInventarioDto, type GerarBalancoDto, type ImportarBalancoDto,
  type ImportarBalancoSincronizarDto, type SincronizarInventarioDto,
} from '@apollo/shared';
import { InventarioService } from './inventario.service';
import { BalancoService } from './balanco.service';
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
  constructor(
    private readonly svc: InventarioService,
    private readonly balanco: BalancoService,
  ) {}

  /** popula a folha de contagem a partir de PRODUTOS (filtros ativo/com-saldo). */
  @Post(':id/importar-produtos')
  @HttpCode(200)
  @RequerAcesso('FRMINVENTARIO', 'IMPORTARPRODUTOS1')
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
  @RequerAcesso('FRMINVENTARIO', 'ATUALIZAESTOQUE1')
  aplicar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(aplicarInventarioSchema)) body: AplicarInventarioDto,
  ) {
    return this.svc.aplicar(id, { senhaOperacao: body.senhaOperacao });
  }

  /**
   * GERAR BALANÇO a partir da folha (comando "Gerar Balanco à partir do Inventário", opção RBAC própria no
   * golden: GERARBALANCO1). Com foto já lançada na data, exige `substituir` — e então o "substituir" é parcial,
   * como no legado (só atualiza produto que já está na foto).
   */
  @Post(':id/gerar-balanco')
  @HttpCode(200)
  @RequerAcesso('FRMINVENTARIO', 'GERARBALANCO1')
  gerarBalanco(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(gerarBalancoSchema)) body: GerarBalancoDto,
  ) {
    return this.balanco.gerarDoInventario(id, body);
  }

  /**
   * IMPORTAR BALANÇO para a folha (comando "Importar Balanço"). **Não tem opção RBAC própria no golden** — as 12
   * opções de FRMINVENTARIO não incluem este item do popup, logo responde ao gate da própria tela.
   */
  @Post(':id/importar-balanco')
  @HttpCode(200)
  @RequerAcesso('FRMINVENTARIO', 'FRMINVENTARIO')
  importarBalanco(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(importarBalancoSchema)) body: ImportarBalancoDto,
  ) {
    return this.balanco.importarBalanco(id, body);
  }

  /**
   * IMPORTAR BALANÇO E ATUALIZAR ESTOQUE (comando 3 do popup): reconstrói a folha somando o movimento do
   * intervalo à foto, nos dois sentidos. Sem opção RBAC própria no golden ⇒ gate da tela.
   */
  @Post(':id/importar-balanco-sincronizar')
  @HttpCode(200)
  @RequerAcesso('FRMINVENTARIO', 'FRMINVENTARIO')
  importarBalancoSincronizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(importarBalancoSincronizarSchema)) body: ImportarBalancoSincronizarDto,
  ) {
    return this.balanco.importarSincronizando(id, body);
  }

  /**
   * SINCRONIZAR INVENTÁRIO (ENTRADAS − SAÍDAS) — recalcula as linhas que já estão na folha. Opção RBAC própria
   * no golden: SINCRONIZARINVENTRIO1 (34 linhas / 15 operadores).
   */
  @Post(':id/sincronizar')
  @HttpCode(200)
  @RequerAcesso('FRMINVENTARIO', 'SINCRONIZARINVENTRIO1')
  sincronizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(sincronizarInventarioSchema)) body: SincronizarInventarioDto,
  ) {
    return this.balanco.sincronizarMovimentos(id, body);
  }
}

/** lookup das fotos (a view `GET_BALANCO` do legado, filtrada por empresa). Path próprio p/ não colidir com `:id`. */
@Controller('cadastro/balanco')
@UseGuards(AcessoGuard)
export class BalancoController {
  constructor(private readonly balanco: BalancoService) {}

  @Get()
  @RequerAcesso('FRMINVENTARIO', 'FRMINVENTARIO')
  listar() {
    return this.balanco.listar();
  }
}
