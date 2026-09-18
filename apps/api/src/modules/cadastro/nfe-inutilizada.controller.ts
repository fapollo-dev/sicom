import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { nfeInutilizadaConsultaSchema, nfeInutilizadaSchema, type NfeInutilizadaConsultaDto, type NfeInutilizadaDto } from '@apollo/shared';
import { NfeInutilizadaService } from './nfe-inutilizada.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** NF-e / NFC-e INUTILIZADAS (`FRMNFE_INUTILIZADA`). */
@Controller('fiscal/nfe-inutilizada')
@UseGuards(AcessoGuard)
export class NfeInutilizadaController {
  constructor(private readonly svc: NfeInutilizadaService) {}

  @Get() @RequerAcesso('FRMNFE_INUTILIZADA', 'FRMNFE_INUTILIZADA')
  consultar(@Query(new ZodValidationPipe(nfeInutilizadaConsultaSchema)) q: NfeInutilizadaConsultaDto) { return this.svc.consultar(q); }

  /** os números que não foram emitidos nem inutilizados — o buraco que o fisco pergunta. */
  @Get('buracos') @RequerAcesso('FRMNFE_INUTILIZADA', 'FRMNFE_INUTILIZADA')
  buracos(@Query('tiponf') tiponf: string, @Query('serie') serie: string, @Query('dataIni') dataIni: string, @Query('dataFim') dataFim: string) {
    return this.svc.buracos(tiponf === 'NFE' ? 'NFE' : 'NFCE', serie ?? '', dataIni, dataFim);
  }

  @Get(':id') @RequerAcesso('FRMNFE_INUTILIZADA', 'FRMNFE_INUTILIZADA')
  obter(@Param('id', ParseIntPipe) id: number) { return this.svc.obter(id); }

  @Post() @RequerAcesso('FRMNFE_INUTILIZADA', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(nfeInutilizadaSchema)) b: NfeInutilizadaDto) { return this.svc.criar(b); }

  @Put(':id') @RequerAcesso('FRMNFE_INUTILIZADA', 'BTNGRAVAR')
  atualizar(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(nfeInutilizadaSchema)) b: NfeInutilizadaDto) { return this.svc.atualizar(id, b); }

  @Delete(':id') @RequerAcesso('FRMNFE_INUTILIZADA', 'BTNEXCLUIR')
  excluir(@Param('id', ParseIntPipe) id: number) { return this.svc.excluir(id); }
}
