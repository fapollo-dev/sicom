import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relEntradasSaidasSchema, type RelEntradasSaidasDto } from '@apollo/shared';
import { RelEntradasSaidasService } from './rel-entradas-saidas.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** ENTRADAS E SAÍDAS (`FRMRELENTRADASSAIDAS`) — RBAC: gate de tela. */
@Controller('relatorios/entradas-saidas')
@UseGuards(AcessoGuard)
export class RelEntradasSaidasController {
  constructor(private readonly svc: RelEntradasSaidasService) {}

  @Get()
  @RequerAcesso('FRMRELENTRADASSAIDAS', 'FRMRELENTRADASSAIDAS')
  gerar(@Query(new ZodValidationPipe(relEntradasSaidasSchema)) q: RelEntradasSaidasDto) {
    return this.svc.gerar(this.filtro(q));
  }

  /** o Imprimir do comparativo: `Rel_EntradasESaidas_Comparativo.fr3` (a listagem segue sem o SQL do binário novo) */
  @Get('impressao')
  @RequerAcesso('FRMRELENTRADASSAIDAS', 'FRMRELENTRADASSAIDAS')
  impressao(@Query(new ZodValidationPipe(relEntradasSaidasSchema)) q: RelEntradasSaidasDto) {
    return this.svc.impressao(this.filtro(q), q.custo ?? 0, q.venda ?? 0);
  }

  private filtro(q: RelEntradasSaidasDto) {
    return {
      tipo: q.tipo, dataIni: q.dataIni, dataFim: q.dataFim,
      coddpto: q.coddpto ?? null, codgrupo: q.codgrupo ?? null, codsubgrupo: q.codsubgrupo ?? null,
      codfor: q.codfor ?? null, produto: q.produto ?? null, codproduto: q.codproduto ?? null,
      empresas: q.empresas ? q.empresas.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) : null,
      horaIni: q.horaIni ?? null, horaFim: q.horaFim ?? null,
    };
  }
}
