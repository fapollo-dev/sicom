import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { importarVendasNfSchema, type ImportarVendasNfDto } from '@apollo/shared';
import { NfVendasService } from './nf-vendas.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { BusinessRuleError } from '../../shared/errors/app-error';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * NF de saída — IMPORTAR VENDAS, a NF de cupom (uNF.pas:13201; `nf-vendas.service.ts`). Importar é editar a nota:
 * lista, prévia e vínculo pedem BTNGRAVAR, como o gravar da NF.
 */
@Controller('fiscal/nf')
@UseGuards(AcessoGuard)
export class NfVendasController {
  constructor(private readonly svc: NfVendasService) {}

  @Get('vendas/disponiveis')
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  disponiveis(@Query('data_ini') ini?: string, @Query('data_fim') fim?: string, @Query('nrocupom') nrocupom?: string, @Query('codparceiro') codparceiro?: string) {
    if (!ini || !fim || !ISO.test(ini) || !ISO.test(fim)) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    return this.svc.disponiveis({ data_ini: ini, data_fim: fim, nrocupom: nrocupom ? Number(nrocupom) : undefined, codparceiro: codparceiro ? Number(codparceiro) : undefined });
  }

  @Post('vendas/previa')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  previa(@Body(new ZodValidationPipe(importarVendasNfSchema)) body: ImportarVendasNfDto) {
    return this.svc.previa(body);
  }

  @Post(':id/vendas')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  vincular(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(importarVendasNfSchema)) body: ImportarVendasNfDto) {
    return this.svc.vincular(id, body);
  }
}
