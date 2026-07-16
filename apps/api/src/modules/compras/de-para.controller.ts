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
    // guarda NaN (fold auditoria BAIXA): query não-numérico → undefined (lista tudo), nunca WHERE = NaN.
    const n = (v?: string) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
    return this.svc.listar({ idproduto: n(idproduto), codfor: n(codfor) });
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

  /** corte-2 BACKFILL (uAtualizaTipoCodReferenciaFor): re-escaneia os XMLs de entrada e aprende a de-para
   *  'E'(cEAN)/'P'(cProd). ?aplicar=1 grava; sem → preview (conta sem gravar). ?idproduto filtra. */
  @Post('backfill')
  @HttpCode(200)
  @RequerAcesso('FRMCADPRODUTO', 'BTNGRAVAR')
  backfill(@Query('aplicar') aplicar?: string, @Query('idproduto') idproduto?: string) {
    return this.svc.backfill({ aplicar: aplicar === '1' || aplicar === 'true', idproduto: idproduto ? Number(idproduto) : undefined });
  }
}
