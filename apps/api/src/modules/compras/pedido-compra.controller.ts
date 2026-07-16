import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { gerarNfPedidoSchema, importarItensPedidoSchema, liberarLimiteSupervisorSchema, type GerarNfPedidoDto, type LiberarLimiteSupervisorDto } from '@apollo/shared';
import { PedidoCompraService } from './pedido-compra.service';
import { RecebimentoService } from './recebimento.service';
import { AnalisePedidoNfService } from './analise-pedido-nf.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * PEDIDO DE COMPRA — controller VERTICAL das transições de ESTADO (fechar/reabrir) + RECEBIMENTO
 * (gerar NF de entrada). Convive no mesmo caminho `compras/pedidos` do controller do agregado (CRUD):
 * as rotas são distintas por método+path. RBAC FRMPEDIDOCOMPRA (BTNFECHAR/BTNREABRIR/BTNGERARNF).
 */
@Controller('compras/pedidos')
@UseGuards(AcessoGuard)
export class PedidoCompraController {
  constructor(
    private readonly svc: PedidoCompraService,
    private readonly recebimento: RecebimentoService,
    private readonly analise: AnalisePedidoNfService,
  ) {}

  @Post(':id/fechar')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNFECHAR')
  fechar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.fechar(id);
  }

  @Post(':id/reabrir')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNREABRIR')
  reabrir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.reabrir(id);
  }

  /** corte-2: gera as parcelas do pedido (ratear pela condição de pagamento). Retorna { codpedcomp, parcelas, total }.
   *  É uma EDIÇÃO do pedido → gated por BTNGRAVAR (opção real do legado; não há "gerar parcelas" no legado). */
  @Post(':id/gerar-parcelas')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGRAVAR')
  gerarParcelas(@Param('id', ParseIntPipe) id: number) {
    return this.svc.gerarParcelas(id);
  }

  /** corte-final: PROPAGA o preço de venda dos itens ao catálogo (MULTI_PRECO) — "Atualizar preço → On-line". */
  @Post(':id/atualizar-precos')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGRAVAR')
  atualizarPrecos(@Param('id', ParseIntPipe) id: number) {
    return this.svc.atualizarPrecos(id);
  }

  /** corte-final: duplica o pedido (novo rascunho com itens; datas de hoje; sem parcelas). */
  @Post(':id/duplicar')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGRAVAR')
  duplicar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.duplicar(id, false);
  }

  /** corte-final: gera o pedido-ESPELHO de bonificação (BONIFICACAO='S', itens 100% bonificados). */
  @Post(':id/gerar-bonificado')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGRAVAR')
  gerarBonificado(@Param('id', ParseIntPipe) id: number) {
    return this.svc.duplicar(id, true);
  }

  /** LIBERA o limite (caminho do PRÓPRIO operador): exige o grant LIBERAVALORMAX da SESSÃO (§13). */
  @Post(':id/liberar-limite')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'LIBERAVALORMAX')
  liberarLimite(@Param('id', ParseIntPipe) id: number) {
    return this.svc.liberarLimite(id);
  }

  /** LIBERA o limite via OVERRIDE de SUPERVISOR (E8 c3, ChamaLiberacaoLogin). SEM @RequerAcesso: o operador
   *  da sessão NÃO precisa do grant — é o SUPERVISOR (login+senha) que precisa estar em USUARIOS_LIBERAM_VALOR_MAX_EXCEDIDO
   *  (fold da auditoria: o RBAC na sessão tornava este caminho inalcançável para quem mais precisa dele). */
  @Post(':id/liberar-limite-supervisor')
  @HttpCode(200)
  liberarLimiteSupervisor(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(liberarLimiteSupervisorSchema)) body: LiberarLimiteSupervisorDto,
  ) {
    return this.svc.liberarLimite(id, body);
  }

  /** corte-final: importa itens em massa do fornecedor (associados por CODFOR / já comprados). */
  @Post(':id/importar-itens')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGRAVAR')
  importarItens(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(importarItensPedidoSchema)) body: { origem: 'associados' | 'comprados' },
  ) {
    return this.svc.importarItens(id, body.origem);
  }

  /** RECEBIMENTO PARCIAL 1:N: gera a NF de entrada (rascunho) do SALDO do pedido (ou das `quantidades` explícitas).
   *  Chamável VÁRIAS vezes até o saldo zerar. Retorna { codnf, codpedcomp, statusQtd }. */
  @Post(':id/gerar-nf')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGERARNF')
  gerarNf(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(gerarNfPedidoSchema)) body: GerarNfPedidoDto,
  ) {
    return this.recebimento.gerarNf(id, body);
  }

  /** ANÁLISE PEDIDO×NF (corte-1): saldo por produto do pedido (qtd pedida − Σ recebida nas NFs vinculadas). */
  @Get(':id/saldo')
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNGERARNF')
  saldo(@Param('id', ParseIntPipe) id: number) {
    return this.analise.saldo(id);
  }
}
