import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relVendasHoraSchema, type RelVendasHoraDto } from '@apollo/shared';
import { RelVendasHoraService } from './rel-vendas-hora.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** VENDAS POR HORA (rel 07 do hub). RBAC: o mesmo gate do hub — semeado na mig 130. */
@Controller('relatorios/vendas-hora')
@UseGuards(AcessoGuard)
export class RelVendasHoraController {
  constructor(private readonly svc: RelVendasHoraService) {}

  @Post('consultar')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  consultar(@Body(new ZodValidationPipe(relVendasHoraSchema)) dto: RelVendasHoraDto) {
    return this.svc.consultar(dto);
  }
}
