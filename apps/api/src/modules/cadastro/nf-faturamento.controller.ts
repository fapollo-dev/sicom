import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { faturarNfSchema, type FaturarNfDto } from '@apollo/shared';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { NfFaturamentoService } from './nf-faturamento.service';

/**
 * NF — Fase 4: ações de FATURAMENTO (geram títulos financeiros). ESCRITA/EFEITO → exigem
 * permissão (FRMNF). `faturar` materializa N parcelas em ARECEBER/APAGAR (por IDNF); `estornar`
 * apaga os títulos (bloqueado se houver título quitado). Sem conflito de rota com o agregado.
 */
@Controller('fiscal/nf')
@UseGuards(AcessoGuard)
export class NfFaturamentoController {
  constructor(private readonly fat: NfFaturamentoService) {}

  @Post(':id/faturar')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNFATURAR')
  faturar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(faturarNfSchema)) dto: FaturarNfDto,
  ) {
    return this.fat.faturar(id, dto);
  }

  @Post(':id/estornar-faturamento')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNESTORNARFATURAMENTO')
  async estornar(@Param('id', ParseIntPipe) id: number) {
    await this.fat.estornarFaturamento(id);
    return { codnf: id, faturada: 'N' };
  }
}
