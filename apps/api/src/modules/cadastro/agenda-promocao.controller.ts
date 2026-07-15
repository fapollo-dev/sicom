import { Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { AgendaPromocaoService } from './agenda-promocao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * AGENDA DE PROMOÇÃO — controller VERTICAL do workflow (encerrar/reabrir). Convive no caminho
 * `cadastro/agenda-promocao` do controller do agregado (CRUD); rotas distintas por método+path.
 */
@Controller('cadastro/agenda-promocao')
@UseGuards(AcessoGuard)
export class AgendaPromocaoController {
  constructor(private readonly svc: AgendaPromocaoService) {}

  @Post(':id/encerrar')
  @HttpCode(200)
  @RequerAcesso('FRMAGENDAPROMOCAO', 'BTNENCERRAR')
  encerrar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.encerrar(id);
  }

  @Post(':id/reabrir')
  @HttpCode(200)
  @RequerAcesso('FRMAGENDAPROMOCAO', 'BTNENCERRAR')
  reabrir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.reabrir(id);
  }

  /** corte-2: aplica o preço promocional dos itens ativos ao multi_preco (PROMOCAO='S'/VRPROMO). */
  @Post(':id/aplicar')
  @HttpCode(200)
  @RequerAcesso('FRMAGENDAPROMOCAO', 'BTNAPLICARPRECO')
  aplicar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.aplicar(id);
  }
}
