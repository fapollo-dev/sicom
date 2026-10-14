import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { nfFormaPagamentoSchema, type NfFormaPagamentoDto } from '@apollo/shared';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso, RequerSenhaAdministrativa } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { NfAbasService } from './nf-abas.service';

/** as abas da NF que olham o que se liga à nota (formas de pagamento, pedidos, devoluções da compra, CC-e) e a liberação do Total NF */
@Controller('fiscal/nf')
@UseGuards(AcessoGuard)
export class NfAbasController {
  constructor(private readonly svc: NfAbasService) {}

  @Get(':id/formas-pagamento')
  @RequerAcesso('FRMNF', 'FRMNF')
  formasPagamento(@Param('id', ParseIntPipe) id: number) {
    return this.svc.formasPagamento(id);
  }

  @Post(':id/formas-pagamento')
  @RequerAcesso('FRMNF', 'FRMNF')
  adicionarFormaPagamento(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(nfFormaPagamentoSchema)) dto: NfFormaPagamentoDto) {
    return this.svc.adicionarFormaPagamento(id, dto);
  }

  @Delete(':id/formas-pagamento/:cod')
  @RequerAcesso('FRMNF', 'FRMNF')
  excluirFormaPagamento(@Param('id', ParseIntPipe) id: number, @Param('cod', ParseIntPipe) cod: number) {
    return this.svc.excluirFormaPagamento(id, cod);
  }

  @Get(':id/pedidos')
  @RequerAcesso('FRMNF', 'FRMNF')
  pedidos(@Param('id', ParseIntPipe) id: number) {
    return this.svc.pedidos(id);
  }

  @Get(':id/devolucoes-compra')
  @RequerAcesso('FRMNF', 'FRMNF')
  devolucoesCompra(@Param('id', ParseIntPipe) id: number) {
    return this.svc.devolucoesCompra(id);
  }

  @Get(':id/cartas-correcao')
  @RequerAcesso('FRMNF', 'FRMNF')
  cartasCorrecao(@Param('id', ParseIntPipe) id: number) {
    return this.svc.cartasCorrecao(id);
  }

  /** o botão ao lado do "Total NF" (SpeedButton1Click, uNF.pas:16433): na nota importada, a edição do total exige a senha ADM */
  @Post('liberar-total')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'FRMNF')
  @RequerSenhaAdministrativa()
  liberarTotal() {
    return { liberado: true };
  }
}
