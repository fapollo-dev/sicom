import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { lancamentosContabeisSchema, type LancamentosContabeisDto } from '@apollo/shared';
import { LancamentosContabeisService } from './lancamentos-contabeis.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * LANÇAMENTOS CONTÁBEIS (`FRMRELLANCAMENTOSCONTABEIS`) — o razão por lançamento: a árvore de datas, as origens e empresas, o filtro
 * auxiliar, os totais e as diferenças débito × crédito, o "Detalhar" e a importação de lançamentos. RBAC: gate de tela (o legado não
 * separa permissão para os itens do menu).
 */
@Controller('contabil/lancamentos')
@UseGuards(AcessoGuard)
export class LancamentosContabeisController {
  constructor(private readonly svc: LancamentosContabeisService) {}

  @Get('arvore')
  @RequerAcesso('FRMRELLANCAMENTOSCONTABEIS', 'FRMRELLANCAMENTOSCONTABEIS')
  arvore() {
    return this.svc.arvore();
  }

  @Get('origens')
  @RequerAcesso('FRMRELLANCAMENTOSCONTABEIS', 'FRMRELLANCAMENTOSCONTABEIS')
  origens() {
    return this.svc.origens();
  }

  @Get('empresas')
  @RequerAcesso('FRMRELLANCAMENTOSCONTABEIS', 'FRMRELLANCAMENTOSCONTABEIS')
  empresas() {
    return this.svc.empresas();
  }

  @Get('campos')
  @RequerAcesso('FRMRELLANCAMENTOSCONTABEIS', 'FRMRELLANCAMENTOSCONTABEIS')
  campos() {
    return this.svc.campos();
  }

  @Get('diferencas')
  @RequerAcesso('FRMRELLANCAMENTOSCONTABEIS', 'FRMRELLANCAMENTOSCONTABEIS')
  diferencas(@Query('dataIni') dataIni: string, @Query('dataFim') dataFim: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIni ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim ?? '')) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    return this.svc.diferencas(dataIni, dataFim);
  }

  @Get()
  @RequerAcesso('FRMRELLANCAMENTOSCONTABEIS', 'FRMRELLANCAMENTOSCONTABEIS')
  listar(@Query(new ZodValidationPipe(lancamentosContabeisSchema)) q: LancamentosContabeisDto) {
    return this.svc.listar({
      dataIni: q.dataIni, dataFim: q.dataFim, origens: q.origens ?? null, nenhumaOrigem: !!q.nenhumaOrigem,
      empresas: q.empresas ?? null, nenhumaEmpresa: !!q.nenhumaEmpresa, somenteUmLado: !!q.somenteUmLado, lote: q.lote ?? null,
      campo: q.campo ?? null, operador: q.operador ?? null, valor: q.valor ?? null, valor2: q.valor2 ?? null,
    });
  }

  /** a importação do TXT de lançamentos (o conteúdo do arquivo no corpo) */
  @Post('importar')
  @HttpCode(200)
  @RequerAcesso('FRMRELLANCAMENTOSCONTABEIS', 'FRMRELLANCAMENTOSCONTABEIS')
  importar(@Body() b: { conteudo?: string }) {
    return this.svc.importar(String(b?.conteudo ?? ''));
  }

  /** de um lançamento para o documento que o gerou (o "Detalhar" do legado). */
  @Get(':coddiario/origem')
  @RequerAcesso('FRMRELLANCAMENTOSCONTABEIS', 'FRMRELLANCAMENTOSCONTABEIS')
  origem(@Param('coddiario', ParseIntPipe) coddiario: number) {
    return this.svc.origemDoLancamento(coddiario);
  }
}
