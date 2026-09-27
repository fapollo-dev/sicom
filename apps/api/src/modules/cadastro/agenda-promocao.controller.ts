import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
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
  @RequerAcesso('FRMCADAGENDAPROMOCAO', 'ENCERRARPROMOCAO')
  encerrar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.encerrar(id);
  }

  @Post(':id/reabrir')
  @HttpCode(200)
  @RequerAcesso('FRMCADAGENDAPROMOCAO', 'ENCERRARPROMOCAO')
  reabrir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.reabrir(id);
  }

  /** clonar agenda (miClonarAgenda): o rascunho da agenda nova — a gravação é o POST normal. Clonar é incluir registro. */
  @Get(':id/clone')
  @RequerAcesso('FRMCADAGENDAPROMOCAO', 'BTNADICIONARREGISTRO')
  clone(@Param('id', ParseIntPipe) id: number) {
    return this.svc.clone(id);
  }

  /** corte-2: aplica o preço promocional dos itens ativos ao multi_preco (PROMOCAO='S'/VRPROMO). */
  @Post(':id/aplicar')
  @HttpCode(200)
  @RequerAcesso('FRMCADAGENDAPROMOCAO', 'FRMCADAGENDAPROMOCAO')
  aplicar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.aplicar(id);
  }

  /** efeito-PDV: SCHEDULER de vigência — liga/desliga o preço promocional conforme [dtinicio, dtfim) (cron/tenant). */
  @Post('processar-vigencia')
  @HttpCode(200)
  @RequerAcesso('FRMCADAGENDAPROMOCAO', 'FRMCADAGENDAPROMOCAO')
  processarVigencia() {
    return this.svc.processarVigencia();
  }
}
