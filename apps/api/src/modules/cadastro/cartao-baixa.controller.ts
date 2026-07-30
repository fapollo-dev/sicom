import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { baixarCartaoSchema, type BaixarCartaoDto } from '@apollo/shared';
import { CartaoBaixaService } from './cartao-baixa.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CARTÕES corte-2 — BAIXA / LIQUIDAÇÃO em lote (FRMBAIXACARTAO). Convive no caminho `cadastro/cartao` do CRUD do
 * recebível (sub-rotas distintas): `baixar` (liquida os selecionados num lote, credita a conta) e `estornar-lote`.
 */
@Controller('cadastro/cartao')
@UseGuards(AcessoGuard)
export class CartaoBaixaController {
  constructor(private readonly svc: CartaoBaixaService) {}

  @Post('baixar')
  @HttpCode(200)
  @RequerAcesso('FRMBAIXACARTAO', 'BTNGRAVAR')
  baixar(@Body(new ZodValidationPipe(baixarCartaoSchema)) body: BaixarCartaoDto) {
    return this.svc.baixar({ codconta: body.codconta, codvendcartaos: body.codvendcartaos });
  }

  @Post('estornar-lote/:idlote')
  @HttpCode(200)
  @RequerAcesso('FRMBAIXACARTAO', 'BTNESTORNAR')
  estornarLote(@Param('idlote', ParseIntPipe) idlote: number) {
    return this.svc.estornarLote(idlote);
  }
}
