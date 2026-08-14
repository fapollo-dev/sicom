import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relVendasExtrasSchema, type RelVendasExtrasDto } from '@apollo/shared';
import { RelVendasExtrasService } from './rel-vendas-extras.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** LOTE EXTRAS (rel 21/22/26/33/39 do hub). RBAC: o gate do hub — mig 130. */
@Controller('relatorios/vendas-extras')
@UseGuards(AcessoGuard)
export class RelVendasExtrasController {
  constructor(private readonly svc: RelVendasExtrasService) {}

  @Post('ticket-produto')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  ticketProduto(@Body(new ZodValidationPipe(relVendasExtrasSchema)) dto: RelVendasExtrasDto) {
    return this.svc.ticketProduto(dto);
  }

  @Post('promocao-loja')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  promocaoLoja(@Body(new ZodValidationPipe(relVendasExtrasSchema)) dto: RelVendasExtrasDto) {
    return this.svc.promocaoPorLoja(dto);
  }

  @Post('por-departamento')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  porDepartamento(@Body(new ZodValidationPipe(relVendasExtrasSchema)) dto: RelVendasExtrasDto) {
    return this.svc.porDepartamento(dto);
  }

  @Post('por-fornecedor')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  porFornecedor(@Body(new ZodValidationPipe(relVendasExtrasSchema)) dto: RelVendasExtrasDto) {
    return this.svc.porFornecedor(dto);
  }

  @Post('cliente-vendedor')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  clienteVendedor(@Body(new ZodValidationPipe(relVendasExtrasSchema)) dto: RelVendasExtrasDto) {
    return this.svc.clienteVendedor(dto);
  }

  @Post('abc2')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  abc2(@Body(new ZodValidationPipe(relVendasExtrasSchema)) dto: RelVendasExtrasDto) {
    return this.svc.abc2(dto);
  }

  @Post('grid')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  grid(@Body(new ZodValidationPipe(relVendasExtrasSchema)) dto: RelVendasExtrasDto) {
    return this.svc.grid(dto);
  }

  @Post('piscofins-produto')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  piscofinsProduto(@Body(new ZodValidationPipe(relVendasExtrasSchema)) dto: RelVendasExtrasDto) {
    return this.svc.piscofins(dto, false);
  }

  @Post('piscofins-tipo')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  piscofinsTipo(@Body(new ZodValidationPipe(relVendasExtrasSchema)) dto: RelVendasExtrasDto) {
    return this.svc.piscofins(dto, true);
  }

  @Post('data-hora')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  dataHora(@Body(new ZodValidationPipe(relVendasExtrasSchema)) dto: RelVendasExtrasDto) {
    return this.svc.dataHora(dto);
  }
}
