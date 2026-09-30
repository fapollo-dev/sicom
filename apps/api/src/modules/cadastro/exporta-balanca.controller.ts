import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ExportaBalancaService } from './exporta-balanca.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * EXPORTAR PARA BALANÇA (FRMEXPORTABALANCA) — configs + gerar arquivos TOLEDO (PLU/preço) p/ download.
 */
@Controller('cadastro/exporta-balanca')
@UseGuards(AcessoGuard)
export class ExportaBalancaController {
  constructor(private readonly svc: ExportaBalancaService) {}

  /** configs de balança da empresa. */
  @Get('configs')
  @RequerAcesso('FRMEXPORTABALANCA', 'FRMEXPORTABALANCA')
  configs() {
    return this.svc.configs();
  }

  /** o Configurador (BtnConfiguraBal, Tag 1 — BTNCONFIGURABAL): grava a config da balança da loja */
  @Post('configs')
  @HttpCode(200)
  @RequerAcesso('FRMEXPORTABALANCA', 'BTNCONFIGURABAL')
  gravarConfig(@Body() body: Record<string, unknown>) {
    const b = (k: string) => body?.[k] === true || body?.[k] === 'S';
    return this.svc.gravarConfig({
      id: body?.id == null || body.id === '' ? null : Number(body.id), dir_bal: String(body?.dir_bal ?? ''), tipo_bal: String(body?.tipo_bal ?? ''),
      mod_bal: String(body?.mod_bal ?? ''), campo_setor: String(body?.campo_setor ?? ''),
      export_nutricional: b('export_nutricional'), export_receita: b('export_receita'), exporta_tara: b('exporta_tara'), exporta_rdc429: b('exporta_rdc429'),
    });
  }

  @Delete('configs/:id')
  @RequerAcesso('FRMEXPORTABALANCA', 'BTNCONFIGURABAL')
  excluirConfig(@Param('id', ParseIntPipe) id: number) {
    return this.svc.excluirConfig(id);
  }

  /** gera os arquivos da config (TXITENS/CADASTRO/ITENSMGV) e devolve p/ download — o botão "Exportar" (Tag 1). */
  @Post('gerar/:id')
  @HttpCode(200)
  @RequerAcesso('FRMEXPORTABALANCA', 'BTNEXPORTAR')
  gerar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.gerar(id);
  }
}
