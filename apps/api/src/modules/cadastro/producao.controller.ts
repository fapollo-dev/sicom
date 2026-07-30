import { Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ProducaoService } from './producao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * PRODUÇÃO (FRMCADPRODUCAO) — ações verticais de processamento: processar (explode a receita, baixa ingredientes,
 * entra o acabado + kardex) e reverter (estorno simétrico). Convivem no caminho `cadastro/producao` do agregado
 * (CRUD do documento) — rotas distintas por método+path. Decopladas do gravar, como o Scrap decopla o aplicar.
 */
@Controller('cadastro/producao')
@UseGuards(AcessoGuard)
export class ProducaoController {
  constructor(private readonly svc: ProducaoService) {}

  /** PROCESSA a requisição: explode receita → baixa ingredientes + entra acabado (status='P'). */
  @Post(':id/processar')
  @HttpCode(200)
  @RequerAcesso('FRMCADPRODUCAO', 'BTNGRAVAR')
  processar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.processar(id);
  }

  /** REVERTE o processamento (estorno simétrico → status='A'). */
  @Post(':id/reverter')
  @HttpCode(200)
  @RequerAcesso('FRMCADPRODUCAO', 'BTNEXCLUIR')
  reverter(@Param('id', ParseIntPipe) id: number) {
    return this.svc.reverter(id);
  }
}
