import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { gerarParcelasNfSchema, type GerarParcelasNfDto } from '@apollo/shared';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { NfFaturamentoService } from './nf-faturamento.service';
import { NfParcelasService } from './nf-parcelas.service';

/**
 * NF — Fase 4: ações de FATURAMENTO (geram títulos financeiros). ESCRITA/EFEITO → exigem
 * permissão (FRMNF). `faturar` materializa N parcelas em ARECEBER/APAGAR (por IDNF); `estornar`
 * apaga os títulos (bloqueado se houver título quitado). Sem conflito de rota com o agregado.
 */
@Controller('fiscal/nf')
@UseGuards(AcessoGuard)
export class NfFaturamentoController {
  constructor(
    private readonly fat: NfFaturamentoService,
    private readonly parcelas: NfParcelasService,
  ) {}

  /** os padrões da aba de cobrança e se o gerar está liberado (SetConfiguracoesFaturamento) */
  @Get(':id/parcelas/configuracao')
  @RequerAcesso('FRMNF', 'BTNGRAVAR') // o gerar só existe com a nota em edição — é parte do gravar
  configuracaoParcelas(@Param('id', ParseIntPipe) id: number) {
    return this.parcelas.configuracao(id);
  }

  /** "Gerar financeiro": calcula as parcelas (FATURAMENTO) — não grava; vão para a grade e são gravadas com a nota */
  @Post(':id/gerar-parcelas')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNGRAVAR') // o gerar só existe com a nota em edição — é parte do gravar
  gerarParcelas(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(gerarParcelasNfSchema)) dto: GerarParcelasNfDto) {
    return this.parcelas.gerar(id, dto);
  }

  /** "Gerar sequência de duplicatas" (GetID('NRODUP')) */
  @Post('parcelas/sequencia-duplicata')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNGRAVAR') // o gerar só existe com a nota em edição — é parte do gravar
  sequenciaDuplicata() {
    return this.parcelas.proximaDuplicata();
  }

  /** o botão "Faturamento" da nota: os gates do legado e o filtro com que o Faturamento abre */
  @Get(':id/faturamento')
  @RequerAcesso('FRMNF', 'BTNFATURAMENTO')
  daNota(@Param('id', ParseIntPipe) id: number) {
    return this.fat.daNota(id);
  }

  @Post(':id/estornar-faturamento')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNESTORNARFATURAMENTO')
  async estornar(@Param('id', ParseIntPipe) id: number) {
    await this.fat.estornarFaturamento(id);
    return { codnf: id, faturada: 'N' };
  }
}
