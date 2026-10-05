import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { rentabilidadeLegadoSchema, rentabilidadeSchema, type RentabilidadeDto, type RentabilidadeLegadoDto } from '@apollo/shared';
import type { FiltroRentabilidadeLegado } from './rentabilidade-categorias.service';
import { RentabilidadeCategoriasService } from './rentabilidade-categorias.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso, RequerControle } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

const filtroLegado = (q: RentabilidadeLegadoDto): FiltroRentabilidadeLegado => ({
  dataIni: q.dataIni, dataFim: q.dataFim, empresas: q.empresas ?? null,
  dpto: q.dpto ? { texto: q.dpto, modo: q.modoDpto ?? null } : null,
  grupo: q.grupo ? { texto: q.grupo, modo: q.modoGrupo ?? null } : null,
  subgrupo: q.subgrupo ? { texto: q.subgrupo, modo: q.modoSubgrupo ?? null } : null,
  codfor: q.codfor ?? null, despesaOperacional: q.despesaOperacional ?? null,
  somenteScrapImportado: q.somenteScrapImportado ?? false, considerarNf: q.considerarNf ?? false, tipo: q.tipo ?? 'COMPLETO',
});

/** RENTABILIDADE POR CATEGORIAS (`FRMRENTABILIDADECATEGORIAS`) — depois do imposto. RBAC: gate de tela. */
@Controller('relatorios/rentabilidade')
@UseGuards(AcessoGuard)
export class RentabilidadeCategoriasController {
  constructor(private readonly svc: RentabilidadeCategoriasService) {}

  @Get()
  @RequerAcesso('FRMRENTABILIDADECATEGORIAS', 'FRMRENTABILIDADECATEGORIAS')
  @RequerControle('FRMRENTABILIDADECATEGORIAS', 'BTNCONSULTA') // o botão "Consultar" (Tag 1) — permissões de controle
  calcular(@Query(new ZodValidationPipe(rentabilidadeSchema)) q: RentabilidadeDto) {
    return this.svc.calcular({
      nivel: q.nivel, dataIni: q.dataIni, dataFim: q.dataFim,
      despesaOperacional: q.despesaOperacional ?? null,
    });
  }

  /** o relatório do legado (o sqqRel por subgrupo × produto, com INDICE, PARTICIPACAO e ACUMULADO) — a grade da tela */
  @Get('legado')
  @RequerAcesso('FRMRENTABILIDADECATEGORIAS', 'FRMRENTABILIDADECATEGORIAS')
  @RequerControle('FRMRENTABILIDADECATEGORIAS', 'BTNCONSULTA')
  legado(@Query(new ZodValidationPipe(rentabilidadeLegadoSchema)) q: RentabilidadeLegadoDto) {
    return this.svc.relatorio(filtroLegado(q));
  }

  /** a impressão nos layouts do cliente (`at&m_rentabilidade_da_familia[_simp|_totais].fr3`) */
  @Get('impressao')
  @RequerAcesso('FRMRENTABILIDADECATEGORIAS', 'FRMRENTABILIDADECATEGORIAS')
  @RequerControle('FRMRENTABILIDADECATEGORIAS', 'BTNCONSULTA')
  impressao(@Query(new ZodValidationPipe(rentabilidadeLegadoSchema)) q: RentabilidadeLegadoDto) {
    return this.svc.impressao(filtroLegado(q));
  }
}
