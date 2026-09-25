import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { BusinessRuleError } from '../../shared/errors/app-error';
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

  /**
   * processar — o corpo opcional é a tela de processar da entrada (`TfrmEstoqueNF`): `precos` { modo: online|lote|nenhum, sincronizar,
   * itens: CODNFPROD com "Atualizar preço de venda" } e `semAlterarCusto` (CODNFPROD com o "altera custo" desmarcado); sem ele, os padrões
   */
  @Post(':id/processar')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNPROCESSAR')
  async processar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body?: { precos?: { modo?: 'online' | 'lote' | 'nenhum'; sincronizar?: boolean; itens?: number[] }; semAlterarCusto?: number[];
      liberacaoEstoqueNegativo?: { login?: string; senha?: string } },
  ) {
    const modo = body?.precos?.modo;
    if (modo != null && !['online', 'lote', 'nenhum'].includes(modo)) throw new BusinessRuleError('NF_PRECO_MODO_INVALIDO', { modo });
    await this.proc.processar(id, { precos: body?.precos, semAlterarCusto: Array.isArray(body?.semAlterarCusto) ? body!.semAlterarCusto : undefined,
      liberacaoEstoqueNegativo: body?.liberacaoEstoqueNegativo });
    return { codnf: id, proc: 'S' };
  }

  /** os padrões da tela de processar (o modo do preço, Individual/Sincronizar e as marcações de cada item) */
  @Get(':id/processar/opcoes')
  @RequerAcesso('FRMNF', 'BTNPROCESSAR')
  opcoesDoProcessar(@Param('id', ParseIntPipe) id: number) {
    return this.proc.opcoesDoProcessar(id);
  }

  @Post(':id/reverter')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNREVERTER')
  async reverter(@Param('id', ParseIntPipe) id: number, @Body() body?: { liberacaoEstoqueNegativo?: { login?: string; senha?: string } }) {
    await this.proc.reverter(id, { liberacaoEstoqueNegativo: body?.liberacaoEstoqueNegativo });
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

  /** liberar a NF do uso do indexador (ou voltar a usar) — config LIBERA_NF_USO_INDEXADOR + o login do próprio usuário (uNF.pas:17780) */
  @Post(':id/liberar-indexador')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  liberarIndexador(@Param('id', ParseIntPipe) id: number, @Body() body: { login?: string; senha?: string; computador?: string }) {
    return this.proc.liberarIndexador(id, body ?? {});
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
