import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { integracaoCartaoSchema, integracaoDocumentoSchema, type IntegracaoCartaoDto, type IntegracaoDocumentoDto } from '@apollo/shared';
import { CartaoContabilService } from './cartao-contabil.service';
import { BaixaTronContabilService } from './baixa-tron-contabil.service';
import { DocumentosContabilService, type TipoDocumento } from './documentos-contabil.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * INTEGRAÇÃO CONTÁBIL (`FRMTRON`) — corte-1: BAIXA DE CARTÕES (51 · 61 · 62) · corte-2: BAIXAS DE CONTAS A
 * PAGAR (15 + 53/54/55) e A RECEBER (16 + 56/57/58) · corte-3: os lançamentos por DOCUMENTO — cadastro de CP
 * (13) e CR (14), transferências (19), adiantamento (63), movimentação de caixa (64) e convênio (65).
 * O legado tem um gate de tela só (`FRMTRON`, 21 operadores no cliente) — não há permissão por botão, e o
 * estorno responde ao mesmo gate (`btnEstornarClick`).
 */
@Controller('contabil/integracao')
@UseGuards(AcessoGuard)
export class IntegracaoContabilController {
  constructor(
    private readonly cartao: CartaoContabilService,
    private readonly baixa: BaixaTronContabilService,
    private readonly docs: DocumentosContabilService,
  ) {}

  /** prévia: os lotes que a integração pegaria no período (ou o lote informado). */
  @Get('cartao/pendentes')
  @RequerAcesso('FRMTRON', 'FRMTRON')
  pendentes(@Query(new ZodValidationPipe(integracaoCartaoSchema)) q: IntegracaoCartaoDto) {
    return this.cartao.lotesPendentes({ dataIni: q.dataIni, dataFim: q.dataFim, idlote: q.idlote ?? null });
  }

  @Post('cartao')
  @HttpCode(200)
  @RequerAcesso('FRMTRON', 'FRMTRON')
  integrar(@Body(new ZodValidationPipe(integracaoCartaoSchema)) body: IntegracaoCartaoDto) {
    return this.cartao.integrar({ dataIni: body.dataIni, dataFim: body.dataFim, idlote: body.idlote ?? null });
  }

  @Post('cartao/estornar')
  @HttpCode(200)
  @RequerAcesso('FRMTRON', 'FRMTRON')
  estornar(@Body(new ZodValidationPipe(integracaoCartaoSchema)) body: IntegracaoCartaoDto) {
    return this.cartao.estornar({ dataIni: body.dataIni, dataFim: body.dataFim, idlote: body.idlote ?? null });
  }

  // ── corte-2: baixas de contas a pagar e a receber (opções 3 e 4 do radio, `uTron.pas:2105-2106`) ──────────
  @Get('baixa/:lado/pendentes')
  @RequerAcesso('FRMTRON', 'FRMTRON')
  baixaPendentes(@Param('lado') lado: string, @Query(new ZodValidationPipe(integracaoCartaoSchema)) q: IntegracaoCartaoDto) {
    return this.baixa.lotesPendentes(ladoValido(lado), { dataIni: q.dataIni, dataFim: q.dataFim, idlote: q.idlote ?? null });
  }

  @Post('baixa/:lado')
  @HttpCode(200)
  @RequerAcesso('FRMTRON', 'FRMTRON')
  baixaIntegrar(@Param('lado') lado: string, @Body(new ZodValidationPipe(integracaoCartaoSchema)) body: IntegracaoCartaoDto) {
    return this.baixa.integrar(ladoValido(lado), { dataIni: body.dataIni, dataFim: body.dataFim, idlote: body.idlote ?? null });
  }

  @Post('baixa/:lado/estornar')
  @HttpCode(200)
  @RequerAcesso('FRMTRON', 'FRMTRON')
  baixaEstornar(@Param('lado') lado: string, @Body(new ZodValidationPipe(integracaoCartaoSchema)) body: IntegracaoCartaoDto) {
    return this.baixa.estornar(ladoValido(lado), { dataIni: body.dataIni, dataFim: body.dataFim, idlote: body.idlote ?? null });
  }

  // ── corte-3: os lançamentos por DOCUMENTO (a situação vem de cada documento, não da config) ──────────────
  @Post('documento/:tipo')
  @HttpCode(200)
  @RequerAcesso('FRMTRON', 'FRMTRON')
  documentoIntegrar(@Param('tipo') tipo: string, @Body(new ZodValidationPipe(integracaoDocumentoSchema)) body: IntegracaoDocumentoDto) {
    return this.docs.integrar(tipoValido(tipo), { dataIni: body.dataIni, dataFim: body.dataFim, codigo: body.codigo ?? null });
  }

  @Post('documento/:tipo/estornar')
  @HttpCode(200)
  @RequerAcesso('FRMTRON', 'FRMTRON')
  documentoEstornar(@Param('tipo') tipo: string, @Body(new ZodValidationPipe(integracaoDocumentoSchema)) body: IntegracaoDocumentoDto) {
    return this.docs.estornar(tipoValido(tipo), { dataIni: body.dataIni, dataFim: body.dataFim, codigo: body.codigo ?? null });
  }
}

/** o tipo do documento vem na rota; qualquer outra coisa é 400, não 500. */
const TIPOS: TipoDocumento[] = ['CP', 'CR', 'TRANSF', 'ADTO', 'CAIXA', 'CONVENIO'];
function tipoValido(tipo: string): TipoDocumento {
  const t = String(tipo ?? '').toUpperCase() as TipoDocumento;
  if (!TIPOS.includes(t)) throw new BusinessRuleError('TIPO_DOCUMENTO_INVALIDO', { tipo });
  return t;
}

/** o lado vem na rota (`ap`/`ar`); qualquer outra coisa é 400, não 500. */
function ladoValido(lado: string): 'AP' | 'AR' {
  const l = String(lado ?? '').toUpperCase();
  if (l !== 'AP' && l !== 'AR') throw new BusinessRuleError('LADO_INVALIDO', { lado });
  return l;
}
