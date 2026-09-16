import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { descontoTituloSchema, type DescontoTituloDto } from '@apollo/shared';
import { DescontoTituloService } from './desconto-titulo.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** DESCONTO DE TÍTULOS (`FRMDESCONTOTITULO`) — encontro de contas. RBAC: gate de tela. */
@Controller('cobranca/desconto-titulo')
@UseGuards(AcessoGuard)
export class DescontoTituloController {
  constructor(private readonly svc: DescontoTituloService) {}

  @Get()
  @RequerAcesso('FRMDESCONTOTITULO', 'FRMDESCONTOTITULO')
  listar(@Query(new ZodValidationPipe(descontoTituloSchema)) q: DescontoTituloDto) {
    return this.svc.listar({ dataIni: q.dataIni ?? null, dataFim: q.dataFim ?? null, codparceiro: q.codparceiro ?? null });
  }

  @Get(':operacao')
  @RequerAcesso('FRMDESCONTOTITULO', 'FRMDESCONTOTITULO')
  detalhar(@Param('operacao', ParseIntPipe) operacao: number) {
    return this.svc.detalhar(operacao);
  }
}
