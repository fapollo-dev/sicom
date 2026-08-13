import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relVendasDataSchema, type RelVendasDataDto } from '@apollo/shared';
import { RelVendasDataService } from './rel-vendas-data.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** VENDAS DATA (rel 02 do hub). RBAC: o mesmo gate do hub — semeado na mig 130. */
@Controller('relatorios/vendas-data')
@UseGuards(AcessoGuard)
export class RelVendasDataController {
  constructor(private readonly svc: RelVendasDataService) {}

  @Post('consultar')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  consultar(@Body(new ZodValidationPipe(relVendasDataSchema)) dto: RelVendasDataDto) {
    return this.svc.consultar(dto);
  }
}
