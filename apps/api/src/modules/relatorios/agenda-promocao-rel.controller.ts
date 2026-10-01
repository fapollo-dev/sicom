import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { agendaPromocaoRelSchema, type AgendaPromocaoRelDto } from '@apollo/shared';
import { AgendaPromocaoRelService } from './agenda-promocao-rel.service';
import { AgendaPromocaoFr3Service } from './agenda-promocao-fr3.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * RELATÓRIOS DA AGENDA DE PROMOÇÃO — o menu "Outros" do cadastro (btnOutros com Tag 0: vale o gate da tela).
 * docs/04-screen-dossier/dossiers/retaguarda/uCadAgendaPromocao-relatorios.md
 */
@Controller('relatorios/agenda-promocao')
@UseGuards(AcessoGuard)
export class AgendaPromocaoRelController {
  constructor(private readonly svc: AgendaPromocaoRelService, private readonly fr3: AgendaPromocaoFr3Service) {}

  /** a impressão no layout do cliente: o .fr3 da RELATORIOS e os datasets do legado (o navegador desenha) */
  @Get(':id/impressao')
  @RequerAcesso('FRMCADAGENDAPROMOCAO', 'FRMCADAGENDAPROMOCAO')
  impressao(@Param('id', ParseIntPipe) id: number, @Query(new ZodValidationPipe(agendaPromocaoRelSchema)) q: AgendaPromocaoRelDto) {
    return this.fr3.imprimir(id, q);
  }

  @Get(':id')
  @RequerAcesso('FRMCADAGENDAPROMOCAO', 'FRMCADAGENDAPROMOCAO')
  relatorio(@Param('id', ParseIntPipe) id: number, @Query(new ZodValidationPipe(agendaPromocaoRelSchema)) q: AgendaPromocaoRelDto) {
    return this.svc.relatorio(id, q);
  }
}
