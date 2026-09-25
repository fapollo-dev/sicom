import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
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

  /**
   * a análise automática dos itens de entrada: [F7] todos (`repasse-automatico`) ou [F8] um (`?item=CODNFPROD`) — UAnalisaItemNF. O legado
   * exige o usuário com edição e gravação na nota (`fUsuarioComPermissao`) → RBAC de gravação.
   */
  @Post(':id/repasse-automatico')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  repasseAutomatico(@Param('id', ParseIntPipe) id: number, @Query('item') item?: string) {
    return this.proc.repasseAutomatico(id, item != null && item !== '' ? Number(item) : undefined);
  }

  /** sincroniza CFOP (`mapa`), ALÍQUOTA e CST dos itens por DE-PARA (uSincronizaCFOPNotaFiscal). Edição → RBAC de gravação. */
  @Post(':id/sincronizar-cfop')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  sincronizarCfop(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { mapa?: Array<{ de?: string; para?: string }>; aliquotas?: Array<{ de?: string; para?: string }>; csts?: Array<{ de?: string | number; para?: string | number }> },
  ) {
    return this.proc.sincronizarCfop(id, body?.mapa ?? [], body?.aliquotas ?? [], body?.csts ?? []);
  }
}
