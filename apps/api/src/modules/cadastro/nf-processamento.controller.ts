import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { NfProcessamentoService } from './nf-processamento.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * NF — Fase 3: ações de PROCESSAMENTO (movem estoque). Ao contrário do recalcular fiscal
 * (puro, sem RBAC), processar/reverter são ESCRITA/EFEITO → exigem permissão (FRMNF). Sem
 * conflito de rota com o agregado (`POST :id/processar` ≠ `GET/PUT/DELETE :id`).
 */
@Controller('fiscal/nf')
@UseGuards(AcessoGuard)
export class NfProcessamentoController {
  constructor(private readonly proc: NfProcessamentoService) {}

  @Post(':id/processar')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNPROCESSAR')
  async processar(@Param('id', ParseIntPipe) id: number) {
    await this.proc.processar(id);
    return { codnf: id, proc: 'S' };
  }

  @Post(':id/reverter')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNREVERTER')
  async reverter(@Param('id', ParseIntPipe) id: number) {
    await this.proc.reverter(id);
    return { codnf: id, proc: 'N' };
  }

  /** sincroniza o CFOP dos itens por DE-PARA (mapa CFOP-atual→CFOP-novo). Edição → RBAC de gravação. */
  @Post(':id/sincronizar-cfop')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  sincronizarCfop(@Param('id', ParseIntPipe) id: number, @Body() body: { mapa?: Array<{ de?: string; para?: string }> }) {
    return this.proc.sincronizarCfop(id, body?.mapa ?? []);
  }
}
