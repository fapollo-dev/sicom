import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { areceberSchema, atualizarAreceberSchema } from '@apollo/shared';
import { AreceberService } from './areceber.service';
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
  constructor(private readonly svc: AreceberService) {}

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
}
