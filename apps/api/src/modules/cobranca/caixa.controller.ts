import {
  Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { abrirCaixaSchema, movimentoCaixaSchema, fecharCaixaSchema } from '@apollo/shared';
import { CaixaService } from './caixa.service';
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
  constructor(private readonly svc: CaixaService) {}

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
}
