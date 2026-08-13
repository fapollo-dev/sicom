import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relCanceladosSchema, type RelCanceladosDto } from '@apollo/shared';
import { RelCanceladosService } from './rel-cancelados.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CANCELAMENTOS + DESCONTOS DE OPERADOR (rel 28/30/32 do hub). RBAC: o gate do hub — mig 130. */
@Controller('relatorios/cancelados')
@UseGuards(AcessoGuard)
export class RelCanceladosController {
  constructor(private readonly svc: RelCanceladosService) {}

  @Post('resumo')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  resumo(@Body(new ZodValidationPipe(relCanceladosSchema)) dto: RelCanceladosDto) {
    return this.svc.resumo(dto);
  }

  @Post('por-operador')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  porOperador(@Body(new ZodValidationPipe(relCanceladosSchema)) dto: RelCanceladosDto) {
    return this.svc.comItens(dto, false);
  }

  @Post('por-data')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  porData(@Body(new ZodValidationPipe(relCanceladosSchema)) dto: RelCanceladosDto) {
    return this.svc.comItens(dto, true);
  }

  @Post('por-fiscal')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  porFiscal(@Body(new ZodValidationPipe(relCanceladosSchema)) dto: RelCanceladosDto) {
    return this.svc.porFiscal(dto);
  }

  @Post('descontos-resumo')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  descontosResumo(@Body(new ZodValidationPipe(relCanceladosSchema)) dto: RelCanceladosDto) {
    return this.svc.descontosResumo(dto);
  }

  @Post('descontos-itens')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  descontosItens(@Body(new ZodValidationPipe(relCanceladosSchema)) dto: RelCanceladosDto) {
    return this.svc.descontosItens(dto);
  }
}
