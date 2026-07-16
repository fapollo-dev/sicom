import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { deParaSchema, atualizarDeParaSchema, type CriarDeParaDto, type AtualizarDeParaDto } from '@apollo/shared';
import { DeParaService } from './de-para.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * DE-PARA de fornecedor (CODREFERENCIA_FOR) — manutenção standalone (recebimento corte-5). Escopado por
 * fornecedor→empresa no service. RBAC FRMCADPRODUTO (a de-para é a grade de referências do produto).
 */
@Controller('compras/de-para')
@UseGuards(AcessoGuard)
export class DeParaController {
  constructor(private readonly svc: DeParaService) {}

  @Get()
  @RequerAcesso('FRMCADPRODUTO', 'BTNEDITAR')
  listar(@Query('idproduto') idproduto?: string, @Query('codfor') codfor?: string) {
    return this.svc.listar({ idproduto: idproduto ? Number(idproduto) : undefined, codfor: codfor ? Number(codfor) : undefined });
  }

  @Post()
  @HttpCode(201)
  @RequerAcesso('FRMCADPRODUTO', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(deParaSchema)) dto: CriarDeParaDto) {
    return this.svc.criar(dto);
  }

  @Put(':id')
  @HttpCode(200)
  @RequerAcesso('FRMCADPRODUTO', 'BTNGRAVAR')
  atualizar(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(atualizarDeParaSchema)) dto: AtualizarDeParaDto) {
    return this.svc.atualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequerAcesso('FRMCADPRODUTO', 'BTNEXCLUIR')
  remover(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remover(id);
  }
}
