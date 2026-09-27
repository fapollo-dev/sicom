import {
  Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { abrirCaixaSchema, movimentoCaixaSchema, fecharCaixaSchema } from '@apollo/shared';
import { CaixaService } from './caixa.service';
import { CaixaContabilService } from './caixa-contabil.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * ⚠️ RBAC: a nossa tela ÚNICA de caixa é DUAS no legado — `FRMFECHAMENTOCAIXA` (417 grants: abrir, fechar,
 * reabrir) e `FRMMOVCAIXA` (227: o movimento). Como a permissão lá é por TELA, cada ação aqui responde à sua,
 * e com isso 644 concessões reais do cliente voltam a valer (§7w do plano de carga). Estornar um movimento é, no
 * legado, excluí-lo no FRMMOVCAIXA (`BTNEXCLUIR`, conferido por código no cadastro); contabilizar a quebra não tem
 * botão lá (a integração contabiliza) — fica no gate do FRMFECHAMENTOCAIXA.
 * CAIXA — corte-1 (sessão + movimento manual). Controller VERTICAL (o service filtra por
 * codempresa + operador). Path `cobranca/caixa` (coberto pelo TenantMiddleware). Leituras livres
 * (como a fábrica CRUD); as AÇÕES exigem o RBAC da tela do legado de cada uma. `GET /atual` é declarado ANTES de `GET /:id`
 * (senão 'atual' cairia no ParseIntPipe).
 */
@Controller('cobranca/caixa')
@UseGuards(AcessoGuard)
export class CaixaController {
  constructor(
    private readonly svc: CaixaService,
    private readonly contabil: CaixaContabilService,
  ) {}

  /** Sessão aberta do operador logado (+ movimentos), ou null. */
  @Get('atual')
  atual() {
    return this.svc.atual();
  }

  /** Histórico de sessões do escopo. */
  @Get()
  list(@Query() query: Record<string, string>) {
    return this.svc.list(query);
  }

  /** Sessão por código + movimentos. */
  @Get(':id')
  read(@Param('id', ParseIntPipe) id: number) {
    return this.svc.read(id);
  }

  // ── AÇÕES ──
  @Post('abrir')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNABRIR')
  abrir(@Body(new ZodValidationPipe(abrirCaixaSchema)) dto: Record<string, unknown>) {
    return this.svc.abrir(dto);
  }

  @Post('movimentar')
  @HttpCode(200)
  @RequerAcesso('FRMMOVCAIXA', 'BTNGRAVAR')
  movimentar(@Body(new ZodValidationPipe(movimentoCaixaSchema)) dto: Record<string, unknown>) {
    return this.svc.movimentar(dto as { especie: string; valor: number; recurso?: string; obs?: string });
  }

  @Post('mov/:codmov/estornar')
  @HttpCode(200)
  @RequerAcesso('FRMMOVCAIXA', 'BTNEXCLUIR') // no legado o estorno é excluir o movimento (TfrmMovCaixa é cadastro: BTNEXCLUIR por código)
  estornarMovimento(@Param('codmov', ParseIntPipe) codmov: number) {
    return this.svc.estornarMovimento(codmov);
  }

  @Post(':id/fechar')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNFECHA')
  fechar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(fecharCaixaSchema)) dto: Record<string, unknown>,
  ) {
    return this.svc.fechar(id, dto as { valorContado?: number; gerarTituloQuebra?: boolean; obs?: string });
  }

  /** Reabre um caixa fechado (F→A): estorna o título de quebra e limpa a conferência. */
  @Post(':id/reabrir')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'BTNREABRIR')
  reabrir(@Param('id', ParseIntPipe) id: number, @Body() body: { obs?: string }) {
    return this.svc.reabrir(id, { obs: body?.obs });
  }

  /** Contabiliza a quebra/sobra do fechamento no DIÁRIO (corte-2d). */
  @Post(':id/contabilizar')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'FRMFECHAMENTOCAIXA') // sem botão no legado (a integração contabiliza o fechamento)
  contabilizar(@Param('id', ParseIntPipe) id: number) {
    return this.contabil.contabilizarFechamento(id);
  }

  @Post(':id/estornar-contabil')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOCAIXA', 'FRMFECHAMENTOCAIXA')
  estornarContabil(@Param('id', ParseIntPipe) id: number) {
    return this.contabil.estornarFechamento(id);
  }

  // o fechamento do PDV (CX_VENDAS) — a contabilização por forma e a conferência com quebra/sobra — é o FECHAMENTO DE CAIXA
  // (`cobranca/fechamento-caixa`, cortes 1-3) e a opção 8 do TRON (`contabil/integracao/fechamento`).
}
