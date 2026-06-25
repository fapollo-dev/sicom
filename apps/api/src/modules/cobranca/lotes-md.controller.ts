import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { loteCobrancaSchema, type CriarLoteCobrancaDto } from '@apollo/shared';
import { AggregateEngineService } from '../../shared/crud/aggregate-engine.service';
import type { OperadorPesquisa, PesquisaQuery } from '../../shared/crud/crud-config';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { loteCobrancaAggregateConfig } from './lote-cobranca.aggregate';
import { LoteCobrancaRepository } from './lote-cobranca.repository';

/**
 * Controller MESTRE-DETALHE de "Lotes de Cobrança" no caminho `cobranca/lotes-md` (alvo do
 * web). Reusa o AggregateEngineService para list/create/update/delete (header + itens numa
 * transação, substituição de itens, cascata — caminho INALTERADO p/ manter smoke/teste GREEN),
 * mas o READ é ENRIQUECIDO via repositório vertical: master + RAZAO do "Cobrador" + itens
 * com as colunas exibidas (live-join ARECEBER→PARCEIROS→PARCEIROS_END) e JUROS/TOTAL.
 * Substitui o controller genérico da fábrica (que devolvia só {codilotcob, codrcb}).
 */
@Controller('cobranca/lotes-md')
@UseGuards(AcessoGuard)
export class LotesMdController {
  private readonly cfg = loteCobrancaAggregateConfig;

  constructor(
    private readonly engine: AggregateEngineService,
    private readonly repo: LoteCobrancaRepository,
  ) {}

  @Get()
  list(@Query() query: Record<string, string>) {
    const pesquisa: PesquisaQuery = {
      campo: query.campo,
      operador: query.operador as OperadorPesquisa | undefined,
      valor: query.valor,
      orderBy: query.orderBy,
      orderDir: query.orderDir === 'desc' ? 'desc' : 'asc',
      situacao:
        query.situacao === 'inativos' || query.situacao === 'todos' || query.situacao === 'ativos'
          ? query.situacao
          : undefined,
      incluirExcluidos: query.incluirExcluidos === 'true',
      limite: query.limite ? Number(query.limite) : undefined,
    };
    return this.engine.list(this.cfg, pesquisa);
  }

  /** READ enriquecido (tela completa): master + RAZAO + itens com display columns + juros/total. */
  @Get(':id')
  read(@Param('id', ParseIntPipe) id: number) {
    return this.repo.readEnriched(id);
  }

  @Post()
  @RequerAcesso('FRMCADLOTECOBRANCA', 'BTNGRAVAR')
  async criar(@Body(new ZodValidationPipe(loteCobrancaSchema)) dto: CriarLoteCobrancaDto) {
    await this.repo.assertCobradorValido(dto.codparceiro); // FUN='S' (legado SegFornecedor)
    const id = await this.engine.createAggregate(this.cfg, dto as Record<string, unknown>);
    return this.repo.readEnriched(id);
  }

  @Put(':id')
  @RequerAcesso('FRMCADLOTECOBRANCA', 'BTNGRAVAR')
  async atualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(loteCobrancaSchema.partial())) dto: Partial<CriarLoteCobrancaDto>,
  ) {
    if (dto.codparceiro != null) await this.repo.assertCobradorValido(dto.codparceiro);
    await this.engine.updateAggregate(this.cfg, id, dto as Record<string, unknown>);
    return this.repo.readEnriched(id);
  }

  @Delete(':id')
  @RequerAcesso('FRMCADLOTECOBRANCA', 'BTNEXCLUIR')
  @HttpCode(204)
  excluir(@Param('id', ParseIntPipe) id: number) {
    return this.engine.removeAggregate(this.cfg, id);
  }
}
