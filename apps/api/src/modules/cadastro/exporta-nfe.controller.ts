import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { exportaNfeSchema, notasDaManutencaoSchema, salvarXmlNfeSchema, type ExportaNfeDto, type NotasDaManutencaoDto, type SalvarXmlNfeDto } from '@apollo/shared';
import { ExportaNfeService } from './exporta-nfe.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** EXPORTAÇÃO DE NF-e (`FRMEXPORTANFE`) — gate de tela. */
@Controller('fiscal/nf-exportacao')
@UseGuards(AcessoGuard)
export class ExportaNfeController {
  constructor(private readonly svc: ExportaNfeService) {}
  @Get() @RequerAcesso('FRMEXPORTANFE', 'FRMEXPORTANFE') listar(@Query(new ZodValidationPipe(exportaNfeSchema)) q: ExportaNfeDto) { return this.svc.listar(q); }
  @Get(':codnf/xml') @RequerAcesso('FRMEXPORTANFE', 'FRMEXPORTANFE') xml(@Param('codnf', ParseIntPipe) codnf: number) { return this.svc.xml(codnf); }
  /** a grade de manutenção: as notas marcadas na Pesquisa (`fiscal/nf-manutencao`) */
  @Post('manutencao') @HttpCode(200) @RequerAcesso('FRMEXPORTANFE', 'FRMEXPORTANFE')
  manutencao(@Body(new ZodValidationPipe(notasDaManutencaoSchema)) b: NotasDaManutencaoDto) { return this.svc.notasDaManutencao(b.codnfs); }
  /** o "Salvar XML NFe" das notas da grade, num zip */
  @Post('manutencao/xml') @RequerAcesso('FRMEXPORTANFE', 'FRMEXPORTANFE')
  async salvarXml(@Body(new ZodValidationPipe(salvarXmlNfeSchema)) b: SalvarXmlNfeDto, @Res() res: Response) {
    const r = await this.svc.xmlsDaManutencao(b.codnfs, b.separarPorNumero);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${r.nome}"`);
    res.setHeader('X-Notas-Salvas', String(r.salvas));
    res.setHeader('X-Notas-Sem-Xml', String(r.semXml));
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Notas-Salvas, X-Notas-Sem-Xml');
    res.status(200).send(Buffer.from(r.zip));
  }
}
