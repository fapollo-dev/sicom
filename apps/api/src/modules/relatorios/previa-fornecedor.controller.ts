import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  previaFornecedorSchema, previaPeriodoSchema,
  type PreviaFornecedorDto, type PreviaPeriodoDto,
} from '@apollo/shared';
import { PreviaFornecedorService } from './previa-fornecedor.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * PRÉVIA DO FORNECEDOR / ANÁLISE DE GIRO (FRMRELLISTAPRECOSFORNECEDOR). POST porque o filtro é objeto.
 * RBAC: gate de TELA — a única opção que existe no Oracle p/ este form (48 grants, nenhuma opção de campo).
 */
@Controller('relatorios/previa-fornecedor')
@UseGuards(AcessoGuard)
export class PreviaFornecedorController {
  constructor(private readonly svc: PreviaFornecedorService) {}

  /** matriz produto × 15 dias (giro por dia) + estoque/última entrada + totais. */
  @Post('matriz')
  @HttpCode(200)
  @RequerAcesso('FRMRELLISTAPRECOSFORNECEDOR', 'FRMRELLISTAPRECOSFORNECEDOR')
  matriz(@Body(new ZodValidationPipe(previaFornecedorSchema)) dto: PreviaFornecedorDto) {
    return this.svc.matriz(dto);
  }

  /**
   * "Habilita Período" (`tpPorPeriodo`) — a 2ª geração do cálculo: UMA faixa livre (unidade × quantidade) com uma
   * linha de totais por produto, e só de quem teve movimento. Endpoint próprio porque a FORMA do resultado é
   * outra (sem matriz de slots), não uma variação de parâmetro.
   */
  @Post('periodo')
  @HttpCode(200)
  @RequerAcesso('FRMRELLISTAPRECOSFORNECEDOR', 'FRMRELLISTAPRECOSFORNECEDOR')
  porPeriodo(@Body(new ZodValidationPipe(previaPeriodoSchema)) dto: PreviaPeriodoDto) {
    return this.svc.porPeriodo(dto);
  }
}
