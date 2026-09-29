import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { AcessoService } from '../../shared/acesso/acesso.service';
import { manifestoListarSchema, manifestoIgnorarSchema, type ManifestoListarDto, type ManifestoIgnorarDto } from '@apollo/shared';
import { ManifestoDfeService } from './manifesto-dfe.service';
import { ManifestoPrevisaoService } from './manifesto-previsao.service';
import { BusinessRuleError, ForbiddenActionError } from '../../shared/errors/app-error';
import { SefazDfeService, EVENTOS_MANIFESTO } from './sefaz-dfe.service';
import { manifestarSchema, manifestarLoteSchema, type ManifestarDto, type ManifestarLoteDto } from '@apollo/shared';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** MANIFESTO DO DFe (FRMMANIFESTODFE) — corte 1 local. RBAC: as opções REAIS do form (mig 148). */
@Controller('compras/manifesto-dfe')
@UseGuards(AcessoGuard)
export class ManifestoDfeController {
  constructor(
    private readonly svc: ManifestoDfeService,
    private readonly sefaz: SefazDfeService,
    private readonly previsao: ManifestoPrevisaoService,
    private readonly acesso: AcessoService,
  ) {}

  /** a previsão de A Pagar da nota (binário novo): as parcelas sugeridas — a grade financeira, o XML ou o total */
  @Get('previsao-apagar/:cod')
  @RequerAcesso('FRMMANIFESTODFE', 'FRMMANIFESTODFE')
  previsaoSugestao(@Param('cod', ParseIntPipe) cod: number) {
    return this.previsao.sugestao(cod);
  }

  /** gera a previsão (um título por parcela, sem CAIXA; o faturamento da nota a converte) */
  @Post('previsao-apagar/:cod')
  @HttpCode(200)
  @RequerAcesso('FRMMANIFESTODFE', 'BTNIMPORTAR')
  previsaoGerar(@Param('cod', ParseIntPipe) cod: number, @Body() body: { parcelas?: Array<{ nrparcela?: string; valor: number; dtvenc: string }> }) {
    const parcelas = Array.isArray(body?.parcelas) ? body.parcelas : undefined;
    if (parcelas?.some((p) => !(Number(p?.valor) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(String(p?.dtvenc ?? '')))) {
      throw new BusinessRuleError('PREVISAO_MANIFESTO_PARCELA_INVALIDA');
    }
    return this.previsao.gerar(cod, { parcelas: parcelas?.map((p) => ({ nrparcela: p.nrparcela, valor: Number(p.valor), dtvenc: String(p.dtvenc) })) });
  }

  /**
   * a lista das notas guardadas: no legado é o "Pesquisar últimas" (btnPesquisarUltimas → PesquisarNotasFiscais) e, com filtros, a
   * "Pesquisa avançada" (btnPesquisaAvancada) — ambos Tag 1. O "Buscar notas" (BTNBUSCARNOTAS) é a consulta à SEFAZ (o `sincronizar`).
   */
  @Post('listar')
  @HttpCode(200)
  @RequerAcesso('FRMMANIFESTODFE', 'BTNPESQUISARULTIMAS')
  async listar(@Body(new ZodValidationPipe(manifestoListarSchema)) dto: ManifestoListarDto) {
    if ((dto.fornecedor?.trim() || dto.dtini || dto.dtfim) && !(await this.acesso.possuiAcesso('FRMMANIFESTODFE', 'BTNPESQUISAAVANCADA'))) {
      throw new ForbiddenActionError('SEM_PERMISSAO', { form: 'FRMMANIFESTODFE', opcao: 'BTNPESQUISAAVANCADA' });
    }
    return this.svc.listar(dto);
  }

  @Get('eventos/:chave')
  @RequerAcesso('FRMMANIFESTODFE', 'FRMMANIFESTODFE')
  eventos(@Param('chave') chave: string) {
    return this.svc.eventos(chave);
  }

  // ignorar é uma decisão de manifestação — gate BTNMANIFESTACAO (a opção real que cobre as ações da fila)
  @Post('ignorar')
  @HttpCode(200)
  @RequerAcesso('FRMMANIFESTODFE', 'BTNMANIFESTACAO')
  ignorar(@Body(new ZodValidationPipe(manifestoIgnorarSchema)) dto: ManifestoIgnorarDto) {
    return this.svc.ignorar(dto.codnfe_naocad, dto.motivo ?? null, dto.reverter === true);
  }

  /** corte 2 — busca notas novas na SEFAZ (distribuição DF-e por último NSU). */
  @Post('sincronizar')
  @HttpCode(200)
  @RequerAcesso('FRMMANIFESTODFE', 'BTNBUSCARNOTAS')
  sincronizar() {
    return this.sefaz.sincronizar();
  }

  /** corte 2 — envia o evento de manifestação (ciência/confirmação/desconhecimento/op. não realizada). */
  @Post('manifestar')
  @HttpCode(200)
  @RequerAcesso('FRMMANIFESTODFE', 'BTNMANIFESTACAO')
  manifestar(@Body(new ZodValidationPipe(manifestarSchema)) dto: ManifestarDto) {
    return this.sefaz.manifestar(dto.chave, dto.evento as keyof typeof EVENTOS_MANIFESTO, dto.justificativa);
  }

  /** as notas marcadas na grade (ManifestacaoDestinatario): um evento por chave, com o log de cada uma */
  @Post('manifestar-lote')
  @HttpCode(200)
  @RequerAcesso('FRMMANIFESTODFE', 'BTNMANIFESTACAO')
  manifestarLote(@Body(new ZodValidationPipe(manifestarLoteSchema)) dto: ManifestarLoteDto) {
    return this.svc.manifestarLote(dto.chaves, dto.evento as keyof typeof EVENTOS_MANIFESTO, dto.justificativa);
  }

  /** importa a NF-e da fila (exige confirmação 210200; usa o import de XML existente). */
  @Post('importar/:cod')
  @HttpCode(200)
  @RequerAcesso('FRMMANIFESTODFE', 'BTNIMPORTAR')
  importar(@Param('cod', ParseIntPipe) cod: number) {
    return this.svc.importar(cod);
  }

  @Get('xml/:chave')
  @RequerAcesso('FRMMANIFESTODFE', 'BTNIMPORTAR')
  xml(@Param('chave') chave: string) {
    return this.svc.xml(chave);
  }
}
