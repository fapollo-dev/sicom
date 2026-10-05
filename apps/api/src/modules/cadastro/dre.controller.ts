import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DreService } from './dre.service';
import { DreRelatorioService, type FiltroDre } from './dre-relatorio.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

const lista = (s?: string) => (s ?? '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0);
const filtroDre = (q: Record<string, string>): FiltroDre => ({
  dataIni: q.dataInicio ?? q.dataIni, dataFim: q.dataFim, empresas: lista(q.empresas), planos: lista(q.planos),
  naoExibirZerados: q.naoExibirZerados === '1' || q.naoExibirZerados === 'true', niveis: q.niveis != null && q.niveis !== '' ? Number(q.niveis) : null,
});

/**
 * DRE CONTÁBIL (relatório) — corte-1. Endpoint de LEITURA/agregação (não-CRUD): calcula a DRE do
 * período/empresa a partir do DIÁRIO + estrutura semeada. Path `cadastro/dre`. RBAC FRMDRE.
 */
@Controller('cadastro/dre')
@UseGuards(AcessoGuard)
export class DreController {
  constructor(
    private readonly svc: DreService,
    private readonly rel: DreRelatorioService,
  ) {}

  @Get()
  @RequerAcesso('FRMRELDRECONTABIL', 'FRMRELDRECONTABIL')
  calcular(@Query() q: Record<string, string>) {
    return this.svc.calcular(q.dataInicio, q.dataFim);
  }

  /** o relatório como o legado o monta (`AntesImprimir`: as linhas por lançamento, os totais F por nível, a fórmula E) e o aviso das contas sem vínculo */
  @Get('relatorio')
  @RequerAcesso('FRMRELDRECONTABIL', 'FRMRELDRECONTABIL')
  relatorio(@Query() q: Record<string, string>) {
    return this.rel.gerar(filtroDre(q));
  }

  /** o "Imprimir": o DRE Contabil.fr3 do cliente (o esquema do TFrmRelMaster) */
  @Get('impressao')
  @RequerAcesso('FRMRELDRECONTABIL', 'FRMRELDRECONTABIL')
  impressao(@Query() q: Record<string, string>) {
    return this.rel.impressao(filtroDre(q));
  }
}
