import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relVendasDepartamentoSchema, type RelVendasDepartamentoDto } from '@apollo/shared';
import { RelVendasDepartamentoService } from './rel-vendas-departamento.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** VENDAS DATA / DEPARTAMENTO (rel 38 do hub). RBAC: o mesmo gate do hub — semeado na mig 130. */
@Controller('relatorios/vendas-departamento')
@UseGuards(AcessoGuard)
export class RelVendasDepartamentoController {
  constructor(private readonly svc: RelVendasDepartamentoService) {}

  @Post('consultar')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  consultar(@Body(new ZodValidationPipe(relVendasDepartamentoSchema)) dto: RelVendasDepartamentoDto) {
    return this.svc.consultar(dto);
  }
}
