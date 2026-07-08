import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { importarXmlNfeSchema, vincularProdutosSchema } from '@apollo/shared';
import { RecebimentoService } from './recebimento.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * RECEBIMENTO — import do XML da NFe do fornecedor → NF de entrada valorada (corte-2). Path próprio
 * `compras/recebimento` porque o import pode ser STANDALONE (sem pedido) ou vinculado (codpedcomp opcional).
 * RBAC FRMPEDIDOCOMPRA/BTNIMPORTARXML (família de compras). O body pode ser grande (NFe com muitos itens);
 * o teto do body-parser foi elevado p/ 5 MB em main.ts.
 */
@Controller('compras/recebimento')
@UseGuards(AcessoGuard)
export class ImportacaoNfeController {
  constructor(private readonly recebimento: RecebimentoService) {}

  @Post('importar-xml')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNIMPORTARXML')
  importarXml(@Body(new ZodValidationPipe(importarXmlNfeSchema)) body: { xml: string; codpedcomp?: number }) {
    return this.recebimento.importarXml(body);
  }

  /** DE-PARA (corte-3): vincula os códigos do fornecedor aos nossos produtos (resolve pendências do import). */
  @Post('vincular-produto')
  @HttpCode(200)
  @RequerAcesso('FRMPEDIDOCOMPRA', 'BTNVINCULARPRODUTO')
  vincularProduto(
    @Body(new ZodValidationPipe(vincularProdutosSchema))
    body: { codfor: number; vinculos: Array<{ idproduto: number; cEAN?: string; cProd?: string; fator?: number }> },
  ) {
    return this.recebimento.vincularProdutos(body);
  }
}
