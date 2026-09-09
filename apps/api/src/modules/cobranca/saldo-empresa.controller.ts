import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { saldoEmpresaSchema, type SaldoEmpresaDto } from '@apollo/shared';
import { SaldoEmpresaService } from './saldo-empresa.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** SALDO DA EMPRESA (`FRMSALDOEMPRESA`) — o fluxo de caixa projetado. RBAC: gate de tela. */
@Controller('cobranca/saldo-empresa')
@UseGuards(AcessoGuard)
export class SaldoEmpresaController {
  constructor(private readonly svc: SaldoEmpresaService) {}

  @Get()
  @RequerAcesso('FRMSALDOEMPRESA', 'FRMSALDOEMPRESA')
  consultar(@Query(new ZodValidationPipe(saldoEmpresaSchema)) q: SaldoEmpresaDto) {
    return this.svc.consultar({ dataIni: q.dataIni, dataFim: q.dataFim, codparceiro: q.codparceiro ?? null });
  }
}
