import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
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
  @RequerAcesso('FRMEXPORTABALANCA', 'BTNGRAVAR')
  configs() {
    return this.svc.configs();
  }

  /** gera os arquivos da config (TXITENS/CADASTRO/ITENSMGV) e devolve p/ download. */
  @Post('gerar/:id')
  @HttpCode(200)
  @RequerAcesso('FRMEXPORTABALANCA', 'BTNGRAVAR')
  gerar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.gerar(id);
  }
}
