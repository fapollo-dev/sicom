import { Controller, Get, Param, Query } from '@nestjs/common';
import { HistoricoDinamicoService } from './historico-dinamico.service';

/** HISTÓRICO DINÂMICO — o visualizador do legado (uHistoricoDinamico). A permissão é o gate de uma das telas que o abrem. */
@Controller('cadastro/historico-dinamico')
export class HistoricoDinamicoController {
  constructor(private readonly svc: HistoricoDinamicoService) {}

  @Get(':tabela/:valor')
  consultar(@Param('tabela') tabela: string, @Param('valor') valor: string, @Query() q: { campo?: string; empresa?: string }) {
    return this.svc.consultar(tabela, valor, q);
  }
}
