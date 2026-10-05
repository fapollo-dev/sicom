import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { relDdeSchema, type RelDdeDto } from '@apollo/shared';
import { RelDdeService, type FiltroDde } from './rel-dde.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

const filtro = (q: RelDdeDto): FiltroDde => ({
  tipo: q.tipo ?? 'PADRAO', dias: q.dias, diasRuptura: q.diasRuptura ?? null, sinal: q.sinal ?? null,
  somenteVendidos: q.somenteVendidos ?? false, idproduto: q.idproduto ?? null, coddpto: q.coddpto ?? null, codgrupo: q.codgrupo ?? null,
  codsubgrupo: q.codsubgrupo ?? null, codsecao: q.codsecao ?? null, codfor: q.codfor ?? null, empresas: q.empresas ?? null,
});

/** DIAS DE ESTOQUE (`FRMRELDDE`) — RBAC: gate de tela. */
@Controller('relatorios/dias-estoque')
@UseGuards(AcessoGuard)
export class RelDdeController {
  constructor(private readonly svc: RelDdeService) {}

  @Get()
  @RequerAcesso('FRMRELDDE', 'FRMRELDDE')
  gerar(@Query(new ZodValidationPipe(relDdeSchema)) q: RelDdeDto) {
    return this.svc.gerar(filtro(q));
  }

  /** o "Gerar cotação" da grade da ruptura (a cotação convencional com os produtos da grade) */
  @Post('cotacao')
  @RequerAcesso('FRMRELDDE', 'FRMRELDDE')
  gerarCotacao(@Body(new ZodValidationPipe(relDdeSchema)) q: RelDdeDto) {
    return this.svc.gerarCotacao(filtro(q));
  }

  /** a impressão nos layouts do cliente (`Dias_de_estoque_*.fr3`) */
  @Get('impressao')
  @RequerAcesso('FRMRELDDE', 'FRMRELDDE')
  impressao(@Query(new ZodValidationPipe(relDdeSchema)) q: RelDdeDto) {
    return this.svc.impressao(filtro(q), q.niveis ?? null);
  }
}
