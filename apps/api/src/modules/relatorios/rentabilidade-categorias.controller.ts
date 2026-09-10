import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { rentabilidadeSchema, type RentabilidadeDto } from '@apollo/shared';
import { RentabilidadeCategoriasService } from './rentabilidade-categorias.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** RENTABILIDADE POR CATEGORIAS (`FRMRENTABILIDADECATEGORIAS`) — depois do imposto. RBAC: gate de tela. */
@Controller('relatorios/rentabilidade')
@UseGuards(AcessoGuard)
export class RentabilidadeCategoriasController {
  constructor(private readonly svc: RentabilidadeCategoriasService) {}

  @Get()
  @RequerAcesso('FRMRENTABILIDADECATEGORIAS', 'FRMRENTABILIDADECATEGORIAS')
  calcular(@Query(new ZodValidationPipe(rentabilidadeSchema)) q: RentabilidadeDto) {
    return this.svc.calcular({
      nivel: q.nivel, dataIni: q.dataIni, dataFim: q.dataFim,
      despesaOperacional: q.despesaOperacional ?? null,
    });
  }
}
