import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { areceberSchema, atualizarAreceberSchema, baixarTituloSchema, gerarParcelasAreceberSchema, agruparAreceberSchema } from '@apollo/shared';
import { AreceberService } from './areceber.service';
import { AreceberBaixaService } from './areceber-baixa.service';
import { AreceberAgrupamentoService } from './areceber-agrupamento.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * CONTAS A RECEBER — corte-1. Contrato REST idêntico ao do CadMaster (list/read/create/update/
 * delete), servido por um controller VERTICAL (o service filtra por codempresa). Path
 * `cadastro/areceber` (coberto pelo TenantMiddleware; NÃO colide com o picker `cobranca/areceber`
 * do Lote de Cobrança). RBAC FRMCADARECEBER nas escritas; leitura livre (como a fábrica CRUD).
 */
@Controller('cadastro/areceber')
@UseGuards(AcessoGuard)
export class AreceberController {
  constructor(
    private readonly svc: AreceberService,
    private readonly baixa: AreceberBaixaService,
    private readonly agrupamento: AreceberAgrupamentoService,
  ) {}

  @Get()
  list(@Query() query: Record<string, string>) {
    return this.svc.list(query);
  }

  @Get(':id')
  read(@Param('id', ParseIntPipe) id: number) {
    return this.svc.read(id);
  }

  @Post()
  @RequerAcesso('FRMCADARECEBER', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(areceberSchema)) dto: Record<string, unknown>) {
    return this.svc.criar(dto);
  }

  /** T1.6 — gera N parcelas manuais a partir de um total (segmento literal → não colide com `:id`). */
  @Post('gerar-parcelas')
  @RequerAcesso('FRMCADARECEBER', 'BTNGRAVAR')
  gerarParcelas(@Body(new ZodValidationPipe(gerarParcelasAreceberSchema)) dto: Record<string, unknown>) {
    return this.svc.gerarParcelas(dto);
  }

  @Put(':id')
  @RequerAcesso('FRMCADARECEBER', 'BTNGRAVAR')
  atualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(atualizarAreceberSchema)) dto: Record<string, unknown>,
  ) {
    return this.svc.atualizar(id, dto);
  }

  @Delete(':id')
  @RequerAcesso('FRMCADARECEBER', 'BTNEXCLUIR')
  @HttpCode(204)
  excluir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.excluir(id);
  }

  // ── BAIXA / recebimento (corte-2) ──
  @Post(':id/baixar')
  @HttpCode(200)
  @RequerAcesso('FRMCADARECEBER', 'BTNBAIXAR')
  baixar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(baixarTituloSchema)) dto: Record<string, unknown>,
  ) {
    return this.baixa.baixar(id, dto);
  }

  @Post(':id/estornar-baixa')
  @HttpCode(200)
  @RequerAcesso('FRMCADARECEBER', 'BTNESTORNARBAIXA')
  estornarBaixa(@Param('id', ParseIntPipe) id: number) {
    return this.baixa.estornar(id);
  }

  // ── AGRUPAMENTO (uAgrupaContasAReceber) ──
  /** agrupa ≥2 títulos abertos do mesmo cliente num consolidado. `agrupar` é segmento literal (≠ `:id`). */
  @Post('agrupar')
  @HttpCode(200)
  @RequerAcesso('FRMAGRUPARECEBER', 'BTNAGRUPAR')
  agrupar(@Body(new ZodValidationPipe(agruparAreceberSchema)) dto: { codrcbs: number[]; dtvenc?: string; obs?: string }) {
    return this.agrupamento.agrupar(dto);
  }

  /** reverte o agrupamento inteiro (o :id é o título CONSOLIDADO). */
  @Post(':id/reverter-agrupamento')
  @HttpCode(200)
  @RequerAcesso('FRMAGRUPARECEBER', 'BTNREVERTER')
  reverterAgrupamento(@Param('id', ParseIntPipe) id: number) {
    return this.agrupamento.reverter(id);
  }

  /** remove UM membro (:membro) do agrupamento consolidado (:id), abatendo o valor. */
  @Post(':id/remover-do-agrupamento/:membro')
  @HttpCode(200)
  @RequerAcesso('FRMAGRUPARECEBER', 'BTNREVERTER')
  removerDoAgrupamento(@Param('id', ParseIntPipe) id: number, @Param('membro', ParseIntPipe) membro: number) {
    return this.agrupamento.removerTitulo(id, membro);
  }

  /** membros de um agrupamento consolidado (consulta). */
  @Get(':id/membros-agrupamento')
  membrosAgrupamento(@Param('id', ParseIntPipe) id: number) {
    return this.agrupamento.membros(id);
  }
}
