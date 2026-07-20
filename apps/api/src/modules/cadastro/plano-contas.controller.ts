import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { planoContasSchema, atualizarPlanoContasSchema } from '@apollo/shared';
import { PlanoContasService } from './plano-contas.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * PLANO DE CONTAS — contrato REST do CadMaster (list/read/create/update/delete) + inativar. Controller
 * VERTICAL (árvore/validações/travas no service). Path `cadastro/plano-contas`. RBAC FRMCADPLANOCONTAS.
 */
@Controller('cadastro/plano-contas')
@UseGuards(AcessoGuard)
export class PlanoContasController {
  constructor(private readonly svc: PlanoContasService) {}

  @Get()
  list(@Query() query: Record<string, string>) {
    return this.svc.list(query);
  }

  // rotas estáticas ANTES de ':id' (senão o param captura 'mascara'/'proximo-codigo').
  @Get('mascara')
  mascara(@Query('tipo') tipo?: string) {
    return this.svc.mascara(tipo || 'E');
  }

  @Get('proximo-codigo')
  proximoCodigo(@Query('codpai') codpai?: string, @Query('tipo') tipo?: string) {
    return this.svc.proximoCodigo(codpai != null && codpai !== '' ? Number(codpai) : null, tipo || 'E');
  }

  @Get(':id')
  read(@Param('id', ParseIntPipe) id: number) {
    return this.svc.read(id);
  }

  @Post()
  @RequerAcesso('FRMCADPLANOCONTAS', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(planoContasSchema)) dto: Record<string, unknown>) {
    return this.svc.criar(dto);
  }

  @Put(':id')
  @RequerAcesso('FRMCADPLANOCONTAS', 'BTNGRAVAR')
  atualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(atualizarPlanoContasSchema)) dto: Record<string, unknown>,
  ) {
    return this.svc.atualizar(id, dto);
  }

  @Delete(':id')
  @RequerAcesso('FRMCADPLANOCONTAS', 'BTNEXCLUIR')
  @HttpCode(204)
  excluir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.excluir(id);
  }

  /** inativar/reativar (alternativa segura à exclusão de conta com histórico). */
  @Post(':id/status')
  @HttpCode(200)
  @RequerAcesso('FRMCADPLANOCONTAS', 'BTNGRAVAR')
  status(@Param('id', ParseIntPipe) id: number, @Body() body: { status?: string }) {
    return this.svc.inativar(id, body?.status === 'I' ? 'I' : 'A');
  }
}
