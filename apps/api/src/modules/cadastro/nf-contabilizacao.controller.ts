import { Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { NfContabilizacaoService } from './nf-contabilizacao.service';

/**
 * NF — Fase 5b: ações CONTÁBEIS (geram/estornam o DIÁRIO — partida dobrada). ESCRITA/EFEITO →
 * exigem permissão (FRMNF). `contabilizar` grava as linhas principais no DIARIO e seta
 * CONTABILIZADO='S'; `estornar-contabilizacao` deleta por (CODORIGEM=12, IDORIGEM=codnf).
 */
@Controller('fiscal/nf')
@UseGuards(AcessoGuard)
export class NfContabilizacaoController {
  constructor(private readonly contab: NfContabilizacaoService) {}

  @Post(':id/contabilizar')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNCONTABILIZAR')
  contabilizar(@Param('id', ParseIntPipe) id: number) {
    return this.contab.contabilizar(id);
  }

  @Post(':id/estornar-contabilizacao')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNESTORNARCONTABIL')
  async estornar(@Param('id', ParseIntPipe) id: number) {
    await this.contab.estornarContabilizacao(id);
    return { codnf: id, contabilizado: null };
  }
}
