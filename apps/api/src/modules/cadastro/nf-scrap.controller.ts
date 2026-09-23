import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { importarScrapNfSchema, type ImportarScrapNfDto } from '@apollo/shared';
import { NfScrapService } from './nf-scrap.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * NF de saída — IMPORTAR SCRAP (a opção "SCRAP" do importar da NF, uNF.pas:1880). Importar é editar a nota: a lista,
 * a prévia e o vínculo (que grava PEDIDO_NF e marca o scrap) pedem BTNGRAVAR, como o gravar da NF. `nf-scrap.service.ts`.
 */
@Controller('fiscal/nf')
@UseGuards(AcessoGuard)
export class NfScrapController {
  constructor(private readonly svc: NfScrapService) {}

  @Get('scrap/disponiveis')
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  disponiveis() {
    return this.svc.disponiveis();
  }

  @Post('scrap/previa')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  previa(@Body(new ZodValidationPipe(importarScrapNfSchema)) body: ImportarScrapNfDto) {
    return this.svc.previa(body);
  }

  @Post(':id/scrap')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  vincular(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(importarScrapNfSchema)) body: ImportarScrapNfDto) {
    return this.svc.vincular(id, body);
  }
}
