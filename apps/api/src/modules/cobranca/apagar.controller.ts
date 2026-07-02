import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { apagarSchema, atualizarApagarSchema, baixarTituloSchema } from '@apollo/shared';
import { ApagarService } from './apagar.service';
import { ApagarBaixaService } from './apagar-baixa.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * CONTAS A PAGAR — gêmea de A Receber. Contrato REST do CadMaster em `cadastro/apagar` (não colide
 * com nada). RBAC FRMCADAPAGAR nas escritas; leitura livre. Baixa/estorno = pagamento.
 */
@Controller('cadastro/apagar')
@UseGuards(AcessoGuard)
export class ApagarController {
  constructor(
    private readonly svc: ApagarService,
    private readonly baixa: ApagarBaixaService,
  ) {}

  @Get()
  list(@Query() query: Record<string, string>) {
    return this.svc.list(query);
  }

  @Get(':id')
  read(@Param('id', ParseIntPipe) id: number) {
    return this.svc.read(id);
  }

  @Post()
  @RequerAcesso('FRMCADAPAGAR', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(apagarSchema)) dto: Record<string, unknown>) {
    return this.svc.criar(dto);
  }

  @Put(':id')
  @RequerAcesso('FRMCADAPAGAR', 'BTNGRAVAR')
  atualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(atualizarApagarSchema)) dto: Record<string, unknown>,
  ) {
    return this.svc.atualizar(id, dto);
  }

  @Delete(':id')
  @RequerAcesso('FRMCADAPAGAR', 'BTNEXCLUIR')
  @HttpCode(204)
  excluir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.excluir(id);
  }

  // ── BAIXA / pagamento (corte-2) ──
  @Post(':id/baixar')
  @HttpCode(200)
  @RequerAcesso('FRMCADAPAGAR', 'BTNBAIXAR')
  baixar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(baixarTituloSchema)) dto: Record<string, unknown>,
  ) {
    return this.baixa.baixar(id, dto);
  }

  @Post(':id/estornar-baixa')
  @HttpCode(200)
  @RequerAcesso('FRMCADAPAGAR', 'BTNESTORNARBAIXA')
  estornarBaixa(@Param('id', ParseIntPipe) id: number) {
    return this.baixa.estornar(id);
  }
}
