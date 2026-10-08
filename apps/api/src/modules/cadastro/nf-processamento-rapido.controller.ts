import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { NfProcessamentoRapidoService } from './nf-processamento-rapido.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * PROCESSAMENTO RÁPIDO DE NOTA FISCAL (`TFrmProcessaNotaFiscal`) — a janela da nota de transferência que nasceu na loja de destino, aberta
 * pela tela da NF da loja de origem. O portão é o da tela da NF (a janela não confere outra permissão); a nota tem de ser de uma loja do
 * operador, e o processamento roda na loja dela.
 */
@Controller('fiscal/nf')
@UseGuards(AcessoGuard)
export class NfProcessamentoRapidoController {
  constructor(private readonly svc: NfProcessamentoRapidoService) {}

  @Get(':id/processamento-rapido')
  @RequerAcesso('FRMNF', 'FRMNF')
  ler(@Param('id', ParseIntPipe) id: number) { return this.svc.ler(id); }

  /** F4 — as situações de transferência do tipo da nota */
  @Get(':id/processamento-rapido/situacoes')
  @RequerAcesso('FRMNF', 'FRMNF')
  situacoes(@Param('id', ParseIntPipe) id: number) { return this.svc.situacoes(id); }

  @Put(':id/processamento-rapido/situacao')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'FRMNF')
  vincularSituacao(@Param('id', ParseIntPipe) id: number, @Body() body: { idsituacao_nf?: unknown }) {
    const sit = Number(body?.idsituacao_nf);
    if (!Number.isInteger(sit) || sit <= 0) throw new BusinessRuleError('NF_RAPIDO_SITUACAO_INVALIDA', { idsituacao_nf: body?.idsituacao_nf ?? null });
    return this.svc.vincularSituacao(id, sit);
  }

  /** F6 — os lançamentos contábeis da nota; o POST os preenche pelos centros de custo da situação */
  @Get(':id/processamento-rapido/lancamentos')
  @RequerAcesso('FRMNF', 'FRMNF')
  lancamentos(@Param('id', ParseIntPipe) id: number) { return this.svc.lancamentos(id); }

  @Post(':id/processamento-rapido/lancamentos')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'FRMNF')
  preencherLancamentos(@Param('id', ParseIntPipe) id: number) { return this.svc.preencherLancamentos(id); }

  /** as opções da tela de processar (o TfrmEstoqueNF), na loja da nota */
  @Get(':id/processamento-rapido/opcoes')
  @RequerAcesso('FRMNF', 'FRMNF')
  opcoes(@Param('id', ParseIntPipe) id: number) { return this.svc.opcoes(id); }

  @Post(':id/processamento-rapido/processar')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'FRMNF')
  processar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body?: { precos?: { modo?: 'online' | 'lote' | 'nenhum'; sincronizar?: boolean; itens?: number[] }; semAlterarCusto?: number[];
      liberacaoEstoqueNegativo?: { login?: string; senha?: string } },
  ) {
    const modo = body?.precos?.modo;
    if (modo != null && !['online', 'lote', 'nenhum'].includes(modo)) throw new BusinessRuleError('NF_PRECO_MODO_INVALIDO', { modo });
    return this.svc.processar(id, { precos: body?.precos, semAlterarCusto: Array.isArray(body?.semAlterarCusto) ? body!.semAlterarCusto : undefined,
      liberacaoEstoqueNegativo: body?.liberacaoEstoqueNegativo });
  }
}
