import { Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ScrapService } from './scrap.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * SCRAP / PERDAS (FRMCADSCRAP) — ações verticais de baixa de estoque: aplicar (dá baixa no estoque + kardex) e
 * estornar (reverte). Convivem no caminho `cadastro/scrap` do agregado (CRUD do documento) — rotas distintas por
 * método+path. Decopladas do gravar, como o Inventário decopla o `aplicar`.
 */
@Controller('cadastro/scrap')
@UseGuards(AcessoGuard)
export class ScrapController {
  constructor(private readonly svc: ScrapService) {}

  /** APLICA a baixa de estoque de todos os itens do scrap (mov_estoque='S'). */
  @Post(':id/aplicar')
  @HttpCode(200)
  @RequerAcesso('FRMCADSCRAP', 'BTNGRAVAR')
  aplicar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.aplicar(id);
  }

  /** ESTORNA a baixa de estoque (reverte o saldo). */
  @Post(':id/estornar')
  @HttpCode(200)
  @RequerAcesso('FRMCADSCRAP', 'BTNEXCLUIR')
  estornar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.estornar(id);
  }
}
