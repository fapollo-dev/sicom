import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ParceiroHistoricoService } from './parceiro-historico.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';

/**
 * HISTÓRICO FINANCEIRO do parceiro (aba tsSaldoParceiros) — endpoint READ-ONLY. Vive sob
 * `cadastro/parceiros` (é a tela do parceiro), mas em rota de 2 segmentos → NÃO colide com o
 * GET `:id` do agregado de parceiros. Leitura livre (como os demais GET de cadastro); o dado
 * financeiro por empresa é escopado no service pelo tenant.
 */
@Controller('cadastro/parceiros')
@UseGuards(AcessoGuard)
export class ParceiroHistoricoController {
  constructor(private readonly svc: ParceiroHistoricoService) {}

  @Get(':cod/historico-financeiro')
  historico(
    @Param('cod', ParseIntPipe) cod: number,
    @Query('status') status?: string,
  ) {
    return this.svc.historico(cod, status);
  }
}
