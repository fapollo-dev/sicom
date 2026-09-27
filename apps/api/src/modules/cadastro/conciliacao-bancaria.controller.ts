import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { importarOfxSchema, importarOfxArquivoSchema, conciliarSchema, conciliarAutomaticaSchema, lancarAutomaticosSchema, type ImportarOfxDto, type ImportarOfxArquivoDto, type ConciliarDto, type ConciliarAutomaticaDto, type LancarAutomaticosDto } from '@apollo/shared';
import { ConciliacaoBancariaService } from './conciliacao-bancaria.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CONCILIAÇÃO BANCÁRIA (OFX) (FRMCONCILIACAOBANCARIA) — importar linhas do extrato, listar pendentes, sugerir o
 * casamento automático (data+valor) e conciliar (marca os dois lados + evento CB).
 */
@Controller('cadastro/conciliacao-bancaria')
@UseGuards(AcessoGuard)
export class ConciliacaoBancariaController {
  constructor(private readonly svc: ConciliacaoBancariaService) {}

  /** importa as linhas do extrato (já parseadas). */
  @Post('importar')
  @HttpCode(200)
  @RequerAcesso('FRMCONCILIACAOBANCARIA', 'FRMCONCILIACAOBANCARIA')
  importar(@Body(new ZodValidationPipe(importarOfxSchema)) body: ImportarOfxDto) {
    return this.svc.importar({ codconta: body.codconta, nomeArquivo: body.nomeArquivo, linhas: body.linhas });
  }

  /** corte-2: importa o arquivo .ofx cru (texto) — o servidor parseia e dedup por FITID. */
  @Post('importar-ofx')
  @HttpCode(200)
  @RequerAcesso('FRMCONCILIACAOBANCARIA', 'FRMCONCILIACAOBANCARIA')
  importarOfx(@Body(new ZodValidationPipe(importarOfxArquivoSchema)) body: ImportarOfxArquivoDto) {
    return this.svc.importarArquivo({ codconta: body.codconta, nomeArquivo: body.nomeArquivo, conteudo: body.conteudo });
  }

  /** pendentes: extrato não-conciliado × razão não-conciliado da conta. */
  @Get('pendentes')
  @RequerAcesso('FRMCONCILIACAOBANCARIA', 'FRMCONCILIACAOBANCARIA')
  pendentes(@Query('codconta', ParseIntPipe) codconta: number) {
    return this.svc.pendentes(codconta);
  }

  /** sugestão automática de casamento (data+valor). */
  @Get('sugestoes')
  @RequerAcesso('FRMCONCILIACAOBANCARIA', 'FRMCONCILIACAOBANCARIA')
  sugestoes(@Query('codconta', ParseIntPipe) codconta: number) {
    return this.svc.sugerir(codconta);
  }

  /** a conciliação AUTOMÁTICA confirmada: um evento por par, cada movimento liberado na data da sua emissão */
  @Post('conciliar-automatica')
  @HttpCode(200)
  @RequerAcesso('FRMCONCILIACAOBANCARIA', 'FRMCONCILIACAOBANCARIA')
  conciliarAutomatica(@Body(new ZodValidationPipe(conciliarAutomaticaSchema)) body: ConciliarAutomaticaDto) {
    return this.svc.conciliarAutomatica({ codconta: body.codconta, pares: body.pares });
  }

  /** concilia os selecionados (Σ valores iguais) → evento CB + marca os dois lados. */
  @Post('conciliar')
  @HttpCode(200)
  @RequerAcesso('FRMCONCILIACAOBANCARIA', 'FRMCONCILIACAOBANCARIA')
  conciliar(@Body(new ZodValidationPipe(conciliarSchema)) body: ConciliarDto) {
    return this.svc.conciliar({ codconta: body.codconta, mboIds: body.mboIds, codmovcontas: body.codmovcontas });
  }

  /** as conciliações feitas na conta */
  @Get('conciliadas')
  @RequerAcesso('FRMCONCILIACAOBANCARIA', 'FRMCONCILIACAOBANCARIA')
  conciliadas(@Query('codconta', ParseIntPipe) codconta: number) {
    return this.svc.conciliadas(codconta);
  }

  /** desfaz a conciliação (o CB, ou a partir de uma linha do extrato ou de um lançamento conciliado) */
  @Post('desfazer')
  @HttpCode(200)
  @RequerAcesso('FRMCONCILIACAOBANCARIA', 'FRMCONCILIACAOBANCARIA')
  desfazer(@Body() body: { cbId?: unknown; mboId?: unknown; codmovconta?: unknown }) {
    const n = (v: unknown) => (v != null && v !== '' && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
    const dto = { cbId: n(body?.cbId), mboId: n(body?.mboId), codmovconta: n(body?.codmovconta) };
    if (dto.cbId == null && dto.mboId == null && dto.codmovconta == null) throw new BusinessRuleError('CONCILIACAO_NAO_ENCONTRADA');
    return this.svc.desfazer(dto);
  }

  /** lança e concilia as linhas pendentes que casam com uma regra 'N' da conta (mig 298). */
  @Post('lancamentos-automaticos')
  @HttpCode(200)
  @RequerAcesso('FRMCONCILIACAOBANCARIA', 'FRMCONCILIACAOBANCARIA')
  lancamentosAutomaticos(@Body(new ZodValidationPipe(lancarAutomaticosSchema)) body: LancarAutomaticosDto) {
    return this.svc.lancarAutomaticos(body.codconta);
  }
}
