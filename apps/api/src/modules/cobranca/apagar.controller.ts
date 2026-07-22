import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { apagarSchema, atualizarApagarSchema, baixarTituloSchema, agruparApagarSchema } from '@apollo/shared';
import { ApagarService } from './apagar.service';
import { ApagarBaixaService } from './apagar-baixa.service';
import { ApagarAgrupamentoService } from './apagar-agrupamento.service';
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

  @Get(':id')
  read(@Param('id', ParseIntPipe) id: number) {
    return this.svc.read(id);
  }

  @Post()
  @RequerAcesso('FRMCADAPAGAR', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(apagarSchema)) dto: Record<string, unknown>) {
    return this.svc.criar(dto);
  }

  @Put(':id')
  @RequerAcesso('FRMCADAPAGAR', 'BTNGRAVAR')
  atualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(atualizarApagarSchema)) dto: Record<string, unknown>,
  ) {
    return this.svc.atualizar(id, dto);
  }

  @Delete(':id')
  @RequerAcesso('FRMCADAPAGAR', 'BTNEXCLUIR')
  @HttpCode(204)
  excluir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.excluir(id);
  }

  // ── BAIXA / pagamento (corte-2) ──
  @Post(':id/baixar')
  @HttpCode(200)
  @RequerAcesso('FRMCADAPAGAR', 'BTNBAIXAR')
  baixar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(baixarTituloSchema)) dto: Record<string, unknown>,
  ) {
    return this.baixa.baixar(id, dto);
  }

  @Post(':id/estornar-baixa')
  @HttpCode(200)
  @RequerAcesso('FRMCADAPAGAR', 'BTNESTORNARBAIXA')
  estornarBaixa(@Param('id', ParseIntPipe) id: number) {
    return this.baixa.estornar(id);
  }

  // ── AGRUPAMENTO (uAgrupaContasAPagar) ──
  /** agrupa ≥2 títulos abertos do mesmo fornecedor num consolidado. `agrupar` = segmento literal (≠ `:id`). */
  @Post('agrupar')
  @HttpCode(200)
  @RequerAcesso('FRMAGRUPAPAGAR', 'BTNAGRUPAR')
  agrupar(@Body(new ZodValidationPipe(agruparApagarSchema)) dto: { codapgs: number[]; dtvenc?: string; obs?: string }) {
    return this.agrupamento.agrupar(dto);
  }

  /** reverte o agrupamento inteiro (o :id é o título CONSOLIDADO). */
  @Post(':id/reverter-agrupamento')
  @HttpCode(200)
  @RequerAcesso('FRMAGRUPAPAGAR', 'BTNREVERTER')
  reverterAgrupamento(@Param('id', ParseIntPipe) id: number) {
    return this.agrupamento.reverter(id);
  }

  /** remove UM membro (:membro) do agrupamento consolidado (:id), abatendo o valor. */
  @Post(':id/remover-do-agrupamento/:membro')
  @HttpCode(200)
  @RequerAcesso('FRMAGRUPAPAGAR', 'BTNREVERTER')
  removerDoAgrupamento(@Param('id', ParseIntPipe) id: number, @Param('membro', ParseIntPipe) membro: number) {
    return this.agrupamento.removerTitulo(id, membro);
  }

  /** membros de um agrupamento consolidado (consulta). */
  @Get(':id/membros-agrupamento')
  membrosAgrupamento(@Param('id', ParseIntPipe) id: number) {
    return this.agrupamento.membros(id);
  }
}
