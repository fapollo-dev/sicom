import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relVendasSchema, type RelVendasDto } from '@apollo/shared';
import { RelVendasService } from './rel-vendas.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * RELATÓRIO DE VENDAS (FRMRELVENDAS) — rel 01 "Produtos vendidos no período". POST (não GET) porque o filtro é um
 * objeto rico (multi-seleção de departamento/grupo/subgrupo/seção). RBAC: o gate do legado é a própria tela.
 */
@Controller('relatorios/vendas')
@UseGuards(AcessoGuard)
export class RelVendasController {
  constructor(private readonly svc: RelVendasService) {}

  /** produtos vendidos no período: 1 linha por (empresa × produto) + totais recalculados. */
  @Post('produtos-vendidos')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  produtosVendidos(@Body(new ZodValidationPipe(relVendasSchema)) dto: RelVendasDto) {
    return this.svc.produtosVendidos(dto);
  }
}
