import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { importarDevolucaoVendasNfSchema, type ImportarDevolucaoVendasNfDto } from '@apollo/shared';
import { NfDevolucaoVendasService } from './nf-devolucao-vendas.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { BusinessRuleError } from '../../shared/errors/app-error';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * NF de entrada — importar a DEVOLUÇÃO DE VENDAS (uNF.pas:5900-6140; `nf-devolucao-vendas.service.ts`). Importar é editar a
 * nota: lista, prévia e vínculo pedem BTNGRAVAR, como o gravar da NF.
 */
@Controller('fiscal/nf')
@UseGuards(AcessoGuard)
export class NfDevolucaoVendasController {
  constructor(private readonly svc: NfDevolucaoVendasService) {}

  @Get('devolucao-vendas/disponiveis')
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  disponiveis(@Query('data_ini') ini?: string, @Query('data_fim') fim?: string, @Query('nrocupom') nrocupom?: string) {
    if (!ini || !fim || !ISO.test(ini) || !ISO.test(fim)) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    return this.svc.disponiveis({ data_ini: ini, data_fim: fim, nrocupom: nrocupom ? Number(nrocupom) : undefined });
  }

  @Post('devolucao-vendas/previa')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  previa(@Body(new ZodValidationPipe(importarDevolucaoVendasNfSchema)) body: ImportarDevolucaoVendasNfDto) {
    return this.svc.previa(body);
  }

  @Post(':id/devolucao-vendas')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  vincular(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(importarDevolucaoVendasNfSchema)) body: ImportarDevolucaoVendasNfDto) {
    return this.svc.vincular(id, body);
  }
}
