import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { relVendasSchema, type RelVendasDto } from '@apollo/shared';
import { RelVendasService } from './rel-vendas.service';
import { RelVendasFr3Service } from './rel-vendas-fr3.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * RELATÓRIO DE VENDAS (FRMRELVENDAS) — rel 01 "Produtos vendidos no período". POST (não GET) porque o filtro é um
 * objeto rico (multi-seleção de departamento/grupo/subgrupo/seção). RBAC: o gate do legado é a própria tela.
 */
const relVendasImpressaoSchema = (relVendasSchema as unknown as z.AnyZodObject).extend({ layout: z.string().min(1) });

@Controller('relatorios/vendas')
@UseGuards(AcessoGuard)
export class RelVendasController {
  constructor(private readonly svc: RelVendasService, private readonly fr3: RelVendasFr3Service) {}

  /** produtos vendidos no período: 1 linha por (empresa × produto) + totais recalculados. */
  @Post('produtos-vendidos')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  produtosVendidos(@Body(new ZodValidationPipe(relVendasSchema)) dto: RelVendasDto) {
    return this.svc.produtosVendidos(dto);
  }

  /** os layouts `ven2_<nn>` do cliente (o combo do hub), com os campos que faltam ao Apollo em cada um */
  @Get('layouts/:numero')
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  layouts(@Param('numero') numero: string) {
    return this.fr3.layouts(numero);
  }

  /** "Imprimir" do rel 01 no layout escolhido (o .fr3 da RELATORIOS com o dbdConsulta do GetSQL(1)) */
  @Post('produtos-vendidos/impressao')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  imprimir(@Body(new ZodValidationPipe(relVendasImpressaoSchema)) dto: z.infer<typeof relVendasImpressaoSchema>) {
    return this.fr3.imprimir01(dto as never);
  }
}
