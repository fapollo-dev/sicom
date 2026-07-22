import {
  Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { abrirCaixaSchema, movimentoCaixaSchema, fecharCaixaSchema, conferirPdvSchema } from '@apollo/shared';
import { CaixaService } from './caixa.service';
import { CaixaContabilService } from './caixa-contabil.service';
import { CaixaPdvContabilService } from './caixa-pdv-contabil.service';
import { CaixaConferenciaService } from './caixa-conferencia.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * CAIXA — corte-1 (sessão + movimento manual). Controller VERTICAL (o service filtra por
 * codempresa + operador). Path `cobranca/caixa` (coberto pelo TenantMiddleware). Leituras livres
 * (como a fábrica CRUD); as AÇÕES exigem RBAC FRMCAIXA. `GET /atual` é declarado ANTES de `GET /:id`
 * (senão 'atual' cairia no ParseIntPipe).
 */
@Controller('cobranca/caixa')
@UseGuards(AcessoGuard)
export class CaixaController {
  constructor(
    private readonly svc: CaixaService,
    private readonly contabil: CaixaContabilService,
    private readonly pdvContabil: CaixaPdvContabilService,
    private readonly conferencia: CaixaConferenciaService,
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
  @RequerAcesso('FRMCAIXA', 'BTNABRIR')
  abrir(@Body(new ZodValidationPipe(abrirCaixaSchema)) dto: Record<string, unknown>) {
    return this.svc.abrir(dto);
  }

  @Post('movimentar')
  @HttpCode(200)
  @RequerAcesso('FRMCAIXA', 'BTNMOVIMENTAR')
  movimentar(@Body(new ZodValidationPipe(movimentoCaixaSchema)) dto: Record<string, unknown>) {
    return this.svc.movimentar(dto as { especie: string; valor: number; recurso?: string; obs?: string });
  }

  @Post('mov/:codmov/estornar')
  @HttpCode(200)
  @RequerAcesso('FRMCAIXA', 'BTNESTORNAR')
  estornarMovimento(@Param('codmov', ParseIntPipe) codmov: number) {
    return this.svc.estornarMovimento(codmov);
  }

  @Post(':id/fechar')
  @HttpCode(200)
  @RequerAcesso('FRMCAIXA', 'BTNFECHAR')
  fechar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(fecharCaixaSchema)) dto: Record<string, unknown>,
  ) {
    return this.svc.fechar(id, dto as { valorContado?: number; gerarTituloQuebra?: boolean; obs?: string });
  }

  /** Reabre um caixa fechado (F→A): estorna o título de quebra e limpa a conferência. */
  @Post(':id/reabrir')
  @HttpCode(200)
  @RequerAcesso('FRMCAIXA', 'BTNREABRIR')
  reabrir(@Param('id', ParseIntPipe) id: number, @Body() body: { obs?: string }) {
    return this.svc.reabrir(id, { obs: body?.obs });
  }

  /** Contabiliza a quebra/sobra do fechamento no DIÁRIO (corte-2d). */
  @Post(':id/contabilizar')
  @HttpCode(200)
  @RequerAcesso('FRMCAIXA', 'BTNCONTABILIZAR')
  contabilizar(@Param('id', ParseIntPipe) id: number) {
    return this.contabil.contabilizarFechamento(id);
  }

  @Post(':id/estornar-contabil')
  @HttpCode(200)
  @RequerAcesso('FRMCAIXA', 'BTNESTORNARCONTABIL')
  estornarContabil(@Param('id', ParseIntPipe) id: number) {
    return this.contabil.estornarFechamento(id);
  }

  /** Caixa 2d-c: contabiliza os fechamentos do PDV (CX_VENDAS) por forma de pagamento no DIÁRIO (situação 2010). */
  @Post('contabilizar-pdv')
  @HttpCode(200)
  @RequerAcesso('FRMCAIXA', 'BTNCONTABILIZARPDV')
  contabilizarPdv(@Query() q: Record<string, string>) {
    return this.pdvContabil.contabilizar(q.dtini, q.dtfim);
  }

  /** estorna a contabilização de um fechamento do PDV (por CODGRUPO). */
  @Post(':codgrupo/reverter-pdv')
  @HttpCode(200)
  @RequerAcesso('FRMCAIXA', 'BTNCONTABILIZARPDV')
  reverterPdv(@Param('codgrupo', ParseIntPipe) codgrupo: number) {
    return this.pdvContabil.reverter(codgrupo);
  }

  /** CAIXA × CX_VENDAS: confere o fechamento do PDV (gaveta contada vs DINHEIRO do CX_VENDAS) → quebra/sobra. */
  @Post('pdv-conferencia/:codgrupo')
  @HttpCode(200)
  @RequerAcesso('FRMCAIXA', 'BTNCONFERIRPDV')
  conferirPdv(@Param('codgrupo', ParseIntPipe) codgrupo: number, @Body(new ZodValidationPipe(conferirPdvSchema)) dto: { valorReal: number; devolucao?: number; gerarTitulo?: boolean }) {
    return this.conferencia.conferir(codgrupo, dto);
  }

  /** estorna a conferência do PDV (reverte divergência + apaga o título-quebra intocado). */
  @Post('pdv-conferencia/:codgrupo/estornar')
  @HttpCode(200)
  @RequerAcesso('FRMCAIXA', 'BTNCONFERIRPDV')
  estornarConferenciaPdv(@Param('codgrupo', ParseIntPipe) codgrupo: number) {
    return this.conferencia.estornar(codgrupo);
  }

  /** consulta a conferência ativa de um grupo (ou null). Leitura livre. */
  @Get('pdv-conferencia/:codgrupo')
  obterConferenciaPdv(@Param('codgrupo', ParseIntPipe) codgrupo: number) {
    return this.conferencia.obter(codgrupo);
  }
}
