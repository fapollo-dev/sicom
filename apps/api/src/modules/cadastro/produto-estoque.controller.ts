import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ProdutoEstoqueService } from './produto-estoque.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';

/**
 * POSIÇÃO DE ESTOQUE — endpoint READ-ONLY sob `cadastro/produtos` (rota de 2 segmentos → não colide com o
 * GET `:id` do agregado). Saldo por empresa + Ficha de movimentação (Kardex). Leitura livre (como os demais GET).
 */
@Controller('cadastro/produtos')
@UseGuards(AcessoGuard)
export class ProdutoEstoqueController {
  constructor(private readonly svc: ProdutoEstoqueService) {}

  @Get(':id/posicao-estoque')
  posicao(@Param('id', ParseIntPipe) id: number) {
    return this.svc.posicao(id);
  }
}
