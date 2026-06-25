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
import { CrudEngineService } from './crud-engine.service';
import type { CrudConfig, OperadorPesquisa, PesquisaQuery } from './crud-config';
import { AcessoGuard } from '../acesso/acesso.guard';
import { RequerAcesso } from '../acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../zod-validation.pipe';

/**
 * Fábrica de controller CRUD (mixin Nest): gera os 5 endpoints REST a partir da
 * CrudConfig — com o AcessoGuard (RBAC) e validação zod — sem controller por entidade.
 * Uma tela trivial passa a ser: 1 config + 1 chamada desta fábrica.
 */
export function createCrudController(opts: {
  path: string;
  config: CrudConfig;
  schema: ZodSchema; // criação
  updateSchema: ZodSchema; // atualização (parcial)
}): Type<unknown> {
  const { path, config, schema, updateSchema } = opts;

  @Controller(path)
  @UseGuards(AcessoGuard)
  class CrudController {
    constructor(readonly engine: CrudEngineService) {}

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
      return this.engine.read(config, id);
    }

    @Post()
    @RequerAcesso(config.rbacForm, 'BTNGRAVAR')
    async criar(@Body(new ZodValidationPipe(schema)) dto: Record<string, unknown>) {
      const id = await this.engine.create(config, dto);
      return this.engine.read(config, id);
    }

    @Put(':id')
    @RequerAcesso(config.rbacForm, 'BTNGRAVAR')
    async atualizar(
      @Param('id', ParseIntPipe) id: number,
      @Body(new ZodValidationPipe(updateSchema)) dto: Record<string, unknown>,
    ) {
      await this.engine.update(config, id, dto);
      return this.engine.read(config, id);
    }

    @Delete(':id')
    @RequerAcesso(config.rbacForm, 'BTNEXCLUIR')
    @HttpCode(204)
    excluir(@Param('id', ParseIntPipe) id: number) {
      return this.engine.remove(config, id);
    }
  }

  return CrudController;
}
