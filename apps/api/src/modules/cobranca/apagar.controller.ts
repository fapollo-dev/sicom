import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { apagarSchema, atualizarApagarSchema, baixarTituloSchema, agruparApagarSchema } from '@apollo/shared';
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

  @Get(':id')
  read(@Param('id', ParseIntPipe) id: number) {
    return this.svc.read(id);
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

  /** membros de um agrupamento consolidado (consulta). */
  @Get(':id/membros-agrupamento')
  membrosAgrupamento(@Param('id', ParseIntPipe) id: number) {
    return this.agrupamento.membros(id);
  }
}
