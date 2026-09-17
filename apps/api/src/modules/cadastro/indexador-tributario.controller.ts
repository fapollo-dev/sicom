import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import {
  filtroIndexadorSchema, indexadorTributarioSchema,
  type FiltroIndexadorDto, type IndexadorTributarioDto,
} from '@apollo/shared';
import { IndexadorTributarioService } from './indexador-tributario.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CADASTRO DO INDEXADOR TRIBUTÁRIO (`FRMCADINDEXADORTRIBUTARIO`). */
@Controller('cadastro/indexador-tributario')
@UseGuards(AcessoGuard)
export class IndexadorTributarioController {
  constructor(private readonly svc: IndexadorTributarioService) {}

  private op(req: { user?: { codoperador?: number } }): number | null {
    return req?.user?.codoperador ?? null;
  }

  @Get()
  @RequerAcesso('FRMCADINDEXADORTRIBUTARIO', 'FRMCADINDEXADORTRIBUTARIO')
  listar(@Query(new ZodValidationPipe(filtroIndexadorSchema)) q: FiltroIndexadorDto) {
    return this.svc.listar(q);
  }

  @Post()
  @RequerAcesso('FRMCADINDEXADORTRIBUTARIO', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(indexadorTributarioSchema)) b: IndexadorTributarioDto, @Req() req: any) {
    return this.svc.criar(b, this.op(req));
  }

  @Put(':cod')
  @RequerAcesso('FRMCADINDEXADORTRIBUTARIO', 'BTNGRAVAR')
  atualizar(@Param('cod', ParseIntPipe) cod: number, @Body(new ZodValidationPipe(indexadorTributarioSchema)) b: IndexadorTributarioDto, @Req() req: any) {
    return this.svc.atualizar(cod, b, this.op(req));
  }

  @Delete(':cod')
  @RequerAcesso('FRMCADINDEXADORTRIBUTARIO', 'BTNEXCLUIR')
  excluir(@Param('cod', ParseIntPipe) cod: number, @Req() req: any) {
    return this.svc.excluir(cod, this.op(req));
  }
}
