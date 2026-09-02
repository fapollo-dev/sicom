import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { nfLoteSchema, type NfLoteDto } from '@apollo/shared';
import { NfLoteService } from './nf-lote.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * LOTES/VALIDADE do item da NF (`uNFLoteValidade`). É sub-tela do item, aberta de dentro da nota — não tem
 * formulário próprio no RBAC do golden, então responde às opções da NF: ler como o agregado lê (só o guard) e
 * escrever com BTNGRAVAR — o mesmo que o legado exige para mexer no item que a contém.
 */
@Controller('fiscal/nf/:id/itens/:codnfprod/lotes')
@UseGuards(AcessoGuard)
export class NfLoteController {
  constructor(private readonly svc: NfLoteService) {}

  /** leitura só com o guard, como o `GET :id` do agregado da NF (não há opção de consulta em FRMNF). */
  @Get()
  listar(@Param('id', ParseIntPipe) codnf: number, @Param('codnfprod', ParseIntPipe) codnfprod: number) {
    return this.svc.listar(codnf, codnfprod);
  }

  @Post()
  @HttpCode(201)
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  criar(
    @Param('id', ParseIntPipe) codnf: number,
    @Param('codnfprod', ParseIntPipe) codnfprod: number,
    @Body(new ZodValidationPipe(nfLoteSchema)) body: NfLoteDto,
  ) {
    return this.svc.criar(codnf, codnfprod, body);
  }

  @Put(':codnfprodlote')
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  alterar(
    @Param('id', ParseIntPipe) codnf: number,
    @Param('codnfprod', ParseIntPipe) codnfprod: number,
    @Param('codnfprodlote', ParseIntPipe) codnfprodlote: number,
    @Body(new ZodValidationPipe(nfLoteSchema)) body: NfLoteDto,
  ) {
    return this.svc.alterar(codnf, codnfprod, codnfprodlote, body);
  }

  @Delete(':codnfprodlote')
  @HttpCode(204)
  @RequerAcesso('FRMNF', 'BTNGRAVAR')
  excluir(
    @Param('id', ParseIntPipe) codnf: number,
    @Param('codnfprod', ParseIntPipe) codnfprod: number,
    @Param('codnfprodlote', ParseIntPipe) codnfprodlote: number,
  ) {
    return this.svc.excluir(codnf, codnfprod, codnfprodlote);
  }
}
