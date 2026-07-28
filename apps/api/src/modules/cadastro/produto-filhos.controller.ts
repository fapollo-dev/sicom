import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ProdutoFilhosService } from './produto-filhos.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';

/**
 * PRODUTOS FILHOS — endpoint READ-ONLY sob `cadastro/produtos` (rota de 2 segmentos → NÃO colide com o
 * GET `:id` do agregado de produtos). Leitura livre (como os demais GET de cadastro).
 */
@Controller('cadastro/produtos')
@UseGuards(AcessoGuard)
export class ProdutoFilhosController {
  constructor(private readonly svc: ProdutoFilhosService) {}

  @Get(':id/filhos')
  filhos(@Param('id', ParseIntPipe) id: number) {
    return this.svc.filhos(id);
  }
}
