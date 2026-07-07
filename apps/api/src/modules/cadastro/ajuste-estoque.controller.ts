import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ajustarEstoqueSchema } from '@apollo/shared';
import { AjusteEstoqueService } from './ajuste-estoque.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * AJUSTE DE ESTOQUE (FRMAJUSTEESTOQUE) — controller VERTICAL (o service filtra por idempresa). Leitura livre
 * (histórico); as AÇÕES (ajustar/estornar) exigem RBAC FRMAJUSTEESTOQUE.
 */
@Controller('cadastro/ajuste-estoque')
@UseGuards(AcessoGuard)
export class AjusteEstoqueController {
  constructor(private readonly svc: AjusteEstoqueService) {}

  @Get()
  listar(@Query('limite') limite?: string) {
    return this.svc.listar(limite ? Number(limite) : undefined);
  }

  @Post()
  @HttpCode(200)
  @RequerAcesso('FRMAJUSTEESTOQUE', 'BTNAJUSTAR')
  ajustar(@Body(new ZodValidationPipe(ajustarEstoqueSchema)) dto: Record<string, unknown>) {
    return this.svc.ajustar(dto as any);
  }

  @Post(':id/estornar')
  @HttpCode(200)
  @RequerAcesso('FRMAJUSTEESTOQUE', 'BTNESTORNAR')
  estornar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.estornar(id);
  }
}
