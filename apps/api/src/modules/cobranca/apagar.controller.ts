import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { apagarSchema, atualizarApagarSchema, baixarTituloSchema, agruparApagarSchema, gerarParcelasApagarSchema, rateioApagarSchema, type GerarParcelasApagarDto, type RateioApagarDto } from '@apollo/shared';
import { ApagarService } from './apagar.service';
import { ApagarBaixaService } from './apagar-baixa.service';
import { ApagarAgrupamentoService, type AgruparApagarInput } from './apagar-agrupamento.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * CONTAS A PAGAR — gêmea de A Receber. Contrato REST do CadMaster em `cadastro/apagar` (não colide
 * com nada). RBAC FRMCADAPAGAR nas escritas; leitura livre. Baixa/estorno = pagamento.
 */
@Controller('cadastro/apagar')
@UseGuards(AcessoGuard)
export class ApagarController {
  constructor(
    private readonly svc: ApagarService,
    private readonly baixa: ApagarBaixaService,
    private readonly agrupamento: ApagarAgrupamentoService,
  ) {}

  @Get()
  list(@Query() query: Record<string, string>) {
    return this.svc.list(query);
  }

  /** a aba PENDÊNCIAS (`sqqPendencias`): antes do `:id` — "pendencias" não é um código */
  @Get('pendencias')
  pendencias(@Query('localizar') localizar?: string) {
    return this.svc.pendencias(localizar);
  }

  @Get(':id')
  read(@Param('id', ParseIntPipe) id: number) {
    return this.svc.read(id);
  }

  /** a aba PARCELAS: o documento inteiro (o grupo) com os totais */
  @Get(':id/parcelas')
  parcelas(@Param('id', ParseIntPipe) id: number) {
    return this.svc.parcelas(id);
  }

  /** a aba ULTIMOS LANÇAMENTOS do fornecedor */
  @Get(':id/ultimos-lancamentos')
  ultimosLancamentos(@Param('id', ParseIntPipe) id: number) {
    return this.svc.ultimosLancamentos(id);
  }

  /** o PROCESSAR sobre o documento gravado (btnGeraParcelas) */
  @Post(':id/gerar-parcelas')
  @HttpCode(200)
  @RequerAcesso('FRMAPAGAR', 'BTNGRAVAR')
  gerarParcelas(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(gerarParcelasApagarSchema)) dto: GerarParcelasApagarDto) {
    return this.svc.gerarParcelas(id, dto);
  }

  /** "Pendência Resolvida" (o aceite da pendência) */
  @Post(':id/resolver-pendencia')
  @HttpCode(200)
  @RequerAcesso('FRMAPAGAR', 'BTNGRAVAR')
  resolverPendencia(@Param('id', ParseIntPipe) id: number) {
    return this.svc.resolverPendencia(id);
  }

  /** o grupo "Lançamento centro custo": as linhas do rateio */
  @Get(':id/rateio')
  rateio(@Param('id', ParseIntPipe) id: number) {
    return this.svc.rateio(id);
  }

  @Put(':id/rateio')
  @RequerAcesso('FRMAPAGAR', 'BTNGRAVAR')
  gravarRateio(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(rateioApagarSchema)) dto: RateioApagarDto) {
    return this.svc.gravarRateio(id, dto);
  }

  @Post()
  @RequerAcesso('FRMAPAGAR', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(apagarSchema)) dto: Record<string, unknown>) {
    return this.svc.criar(dto);
  }

  @Put(':id')
  @RequerAcesso('FRMAPAGAR', 'BTNGRAVAR')
  atualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(atualizarApagarSchema)) dto: Record<string, unknown>,
  ) {
    return this.svc.atualizar(id, dto);
  }

  @Delete(':id')
  @RequerAcesso('FRMAPAGAR', 'BTNEXCLUIR')
  @HttpCode(204)
  excluir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.excluir(id);
  }

  // ── BAIXA / pagamento (corte-2) ──
  @Post(':id/baixar')
  @HttpCode(200)
  @RequerAcesso('FRMBAIXAAPAGAR', 'BTNGRAVAR')
  baixar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(baixarTituloSchema)) dto: Record<string, unknown>,
  ) {
    return this.baixa.baixar(id, dto);
  }

  @Post(':id/estornar-baixa')
  @HttpCode(200)
  @RequerAcesso('FRMBAIXAAPAGAR', 'BTNGRAVAR')
  estornarBaixa(@Param('id', ParseIntPipe) id: number) {
    return this.baixa.estornar(id);
  }

  // ── AGRUPAMENTO (uAgrupaContasAPagar; dossiê uAgrupaContas.md) — RBAC do legado: a tela de agrupar e o botão de reverter
  //    do contas a pagar (FRMAPAGAR.BTNREVERTERAGRUPAMENTO, 152 concessões) ──
  /** agrupa títulos abertos num consolidado (uma ou mais parcelas); com fornecedores diversos, informe o parceiro. */
  @Post('agrupar')
  @HttpCode(200)
  @RequerAcesso('FRMAGRUPACONTASAPAGAR', 'FRMAGRUPACONTASAPAGAR')
  agrupar(@Body(new ZodValidationPipe(agruparApagarSchema)) dto: AgruparApagarInput) {
    return this.agrupamento.agrupar(dto);
  }

  /** reverte o agrupamento inteiro (o :id é uma parcela do CONSOLIDADO). */
  @Post(':id/reverter-agrupamento')
  @HttpCode(200)
  @RequerAcesso('FRMAPAGAR', 'BTNREVERTERAGRUPAMENTO')
  reverterAgrupamento(@Param('id', ParseIntPipe) id: number) {
    return this.agrupamento.reverter(id);
  }

  /** remove UM membro (:membro) do agrupamento consolidado (:id), abatendo o valor. */
  @Post(':id/remover-do-agrupamento/:membro')
  @HttpCode(200)
  @RequerAcesso('FRMAPAGAR', 'BTNREVERTERAGRUPAMENTO')
  removerDoAgrupamento(@Param('id', ParseIntPipe) id: number, @Param('membro', ParseIntPipe) membro: number) {
    return this.agrupamento.removerTitulo(id, membro);
  }

  /** a impressão do agrupamento no layout do cliente (AgrupamentoCP[Agrupado] / AgrupamentoCPCR[Agrupado].fr3) */
  @Get(':id/relatorio-agrupamento/impressao')
  impressaoAgrupamento(@Param('id', ParseIntPipe) id: number, @Query('agrupado') agrupado?: string) {
    return this.agrupamento.impressao(id, agrupado === '1' || agrupado === 'true');
  }

  /** os dados das impressões do agrupamento (o relatório do legado depois de agrupar / pelo consolidado). */
  @Get(':id/relatorio-agrupamento')
  relatorioAgrupamento(@Param('id', ParseIntPipe) id: number) {
    return this.agrupamento.relatorio(id);
  }

  /** membros de um agrupamento consolidado (consulta). */
  @Get(':id/membros-agrupamento')
  membrosAgrupamento(@Param('id', ParseIntPipe) id: number) {
    return this.agrupamento.membros(id);
  }
}
