import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relTrocaMercadoriaSchema, type RelTrocaMercadoriaDto } from '@apollo/shared';
import { RelTrocaMercadoriaService, type FiltroRelTroca } from './rel-troca-mercadoria.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcessoDeAlgum } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

const filtro = (q: RelTrocaMercadoriaDto): FiltroRelTroca => ({
  tipo: q.tipo ?? 'AGRUPADO', dataIni: q.dataIni ?? null, dataFim: q.dataFim ?? null, codtroca: q.codtroca ?? null, codfor: q.codfor ?? null,
  status: q.status ?? 'TODOS', idproduto: q.idproduto ?? null, coddpto: q.coddpto ?? null, codgrupo: q.codgrupo ?? null, codsubgrupo: q.codsubgrupo ?? null,
  empresas: q.empresas ?? null, daTroca: q.daTroca ?? false,
});

/**
 * RELATÓRIO DE TROCA DE MERCADORIAS (`FRMRELTROCAMERCADORIAFOR`) — RBAC: a tela do menu, ou a tela da troca (o "Imprimir" dela abre este
 * relatório por código, `TfrmTrocaMercadoriaFor.btnImprimirClick`).
 */
@Controller('relatorios/troca-mercadoria')
@UseGuards(AcessoGuard)
export class RelTrocaMercadoriaController {
  constructor(private readonly svc: RelTrocaMercadoriaService) {}

  @Get()
  @RequerAcessoDeAlgum(['FRMRELTROCAMERCADORIAFOR', 'FRMRELTROCAMERCADORIAFOR'], ['FRMTROCAMERCADORIAFOR', 'FRMTROCAMERCADORIAFOR'])
  gerar(@Query(new ZodValidationPipe(relTrocaMercadoriaSchema)) q: RelTrocaMercadoriaDto) {
    return this.svc.gerar(filtro(q));
  }

  /** a impressão nos layouts do cliente (`TrocaMercadoria_*.fr3`) */
  @Get('impressao')
  @RequerAcessoDeAlgum(['FRMRELTROCAMERCADORIAFOR', 'FRMRELTROCAMERCADORIAFOR'], ['FRMTROCAMERCADORIAFOR', 'FRMTROCAMERCADORIAFOR'])
  impressao(@Query(new ZodValidationPipe(relTrocaMercadoriaSchema)) q: RelTrocaMercadoriaDto) {
    return this.svc.impressao(filtro(q));
  }
}
