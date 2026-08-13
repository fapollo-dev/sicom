import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relVendasOperadorSchema, type RelVendasOperadorDto } from '@apollo/shared';
import { RelVendasOperadorService } from './rel-vendas-operador.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** FAMÍLIA OPERADOR/VENDEDOR (rel 06/19/25/36/46 do hub). RBAC: o gate do hub — mig 130. */
@Controller('relatorios/vendas-operador')
@UseGuards(AcessoGuard)
export class RelVendasOperadorController {
  constructor(private readonly svc: RelVendasOperadorService) {}

  @Post('data-operador')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  dataOperador(@Body(new ZodValidationPipe(relVendasOperadorSchema)) dto: RelVendasOperadorDto) {
    return this.svc.dataOperador(dto);
  }

  @Post('resumo-operador')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  resumoOperador(@Body(new ZodValidationPipe(relVendasOperadorSchema)) dto: RelVendasOperadorDto) {
    return this.svc.resumoOperador(dto);
  }

  @Post('detalhe-vendedor')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  detalheVendedor(@Body(new ZodValidationPipe(relVendasOperadorSchema)) dto: RelVendasOperadorDto) {
    return this.svc.detalheVendedor(dto);
  }

  @Post('data-vendedor')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  dataVendedor(@Body(new ZodValidationPipe(relVendasOperadorSchema)) dto: RelVendasOperadorDto) {
    return this.svc.dataVendedor(dto);
  }

  @Post('produtos-operador')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  produtosOperador(@Body(new ZodValidationPipe(relVendasOperadorSchema)) dto: RelVendasOperadorDto) {
    return this.svc.produtosOperador(dto);
  }
}
