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
  Type,
  UseGuards,
} from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { AggregateEngineService } from './aggregate-engine.service';
import type { AggregateConfig, OperadorPesquisa, PesquisaQuery } from './crud-config';
import { AcessoGuard } from '../acesso/acesso.guard';
import { RequerAcesso } from '../acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../zod-validation.pipe';

/**
 * Fábrica de controller MESTRE-DETALHE: 5 endpoints sobre o AggregateEngineService —
 * list (view do master), read (agregado: header+itens), create/update (agregado numa
 * transação), delete (cascata). RBAC + zod do agregado inteiro. Sem controller por entidade.
 */
export function createAggregateController(opts: {
  path: string;
  config: AggregateConfig;
  schema: ZodSchema;
  updateSchema: ZodSchema;
}): Type<unknown> {
  const { path, config, schema, updateSchema } = opts;

  @Controller(path)
  @UseGuards(AcessoGuard)
  class AggregateController {
    constructor(readonly engine: AggregateEngineService) {}

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
      return this.engine.list(config, pesquisa);
    }

    @Get(':id')
    read(@Param('id', ParseIntPipe) id: number) {
      return this.engine.readAggregate(config, id);
    }

    @Post()
    @RequerAcesso(config.rbacForm, 'BTNGRAVAR')
    async criar(@Body(new ZodValidationPipe(schema)) dto: Record<string, unknown>) {
      const id = await this.engine.createAggregate(config, dto);
      return this.engine.readAggregate(config, id);
    }

    @Put(':id')
    @RequerAcesso(config.rbacForm, 'BTNGRAVAR')
    async atualizar(
      @Param('id', ParseIntPipe) id: number,
      @Body(new ZodValidationPipe(updateSchema)) dto: Record<string, unknown>,
    ) {
      await this.engine.updateAggregate(config, id, dto);
      return this.engine.readAggregate(config, id);
    }

    @Delete(':id')
    @RequerAcesso(config.rbacForm, 'BTNEXCLUIR')
    @HttpCode(204)
    excluir(@Param('id', ParseIntPipe) id: number) {
      return this.engine.removeAggregate(config, id);
    }
  }

  return AggregateController;
}
