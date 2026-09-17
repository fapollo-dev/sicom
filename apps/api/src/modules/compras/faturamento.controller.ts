import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { faturamentoSchema, type FaturamentoDto } from '@apollo/shared';
import { FaturamentoService } from './faturamento.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** FATURAMENTO DA NOTA (`FRMFATURAMENTO2`) — RBAC: gate de tela. */
@Controller('compras/faturamento')
@UseGuards(AcessoGuard)
export class FaturamentoController {
  constructor(private readonly svc: FaturamentoService) {}

  @Get()
  @RequerAcesso('FRMFATURAMENTO2', 'FRMFATURAMENTO2')
  listar(@Query(new ZodValidationPipe(faturamentoSchema)) q: FaturamentoDto) {
    return this.svc.listar(q);
  }
}
