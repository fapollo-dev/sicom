import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { relCaixaSchema, type RelCaixaDto } from '@apollo/shared';
import { MODELOS_CAIXA, RelCaixaService } from './rel-caixa.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

const filtro = (q: RelCaixaDto) => ({
  modelo: q.modelo, dataIni: q.dataIni, dataFim: q.dataFim, empresas: q.empresas ?? null,
  codoperador: q.codoperador ?? null, codpdv: q.codpdv ?? null, recurso: q.recurso ?? null,
  resumoCC: !!q.resumoCC, somenteCCMovimentadas: !!q.somenteCCMovimentadas,
});

/** RELATÓRIOS DE CAIXA (`FRMRELCAIXA`) — os cinco modelos do combo, a consulta (a grade do "Exibe grade") e a impressão. RBAC: gate de tela. */
@Controller('cobranca/rel-caixa')
@UseGuards(AcessoGuard)
export class RelCaixaController {
  constructor(private readonly svc: RelCaixaService) {}

  @Get()
  @RequerAcesso('FRMRELCAIXA', 'FRMRELCAIXA')
  consultar(@Query(new ZodValidationPipe(relCaixaSchema)) q: RelCaixaDto) {
    return this.svc.consultar(filtro(q));
  }

  /** o "Imprimir": o layout da classe do modelo (Caixa1..Caixa4, Relatorio_Pedidos) no esquema do TFrmRelMaster */
  @Get('impressao')
  @RequerAcesso('FRMRELCAIXA', 'FRMRELCAIXA')
  impressao(@Query(new ZodValidationPipe(relCaixaSchema)) q: RelCaixaDto) {
    return this.svc.impressao(filtro(q), q.niveis ?? null);
  }

  /** o "Imprimir" do Controle de contas correntes (`BtnImprimirClick`): o período e só o resumo das contas do operador — o gate é o da tela
   *  das contas (o legado cria o `TFrmRelCaixa` direto, sem o acesso ao relatório de caixa) */
  @Post('resumo-contas/impressao')
  @HttpCode(200)
  @RequerAcesso('FRMCONTROLECONTASBANCARIAS', 'FRMCONTROLECONTASBANCARIAS')
  impressaoResumoContas(@Body() body: { dataIni?: string; dataFim?: string }) {
    const ini = String(body?.dataIni ?? ''); const fim = String(body?.dataFim ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    if (ini > fim) throw new BusinessRuleError('PERIODO_INVERTIDO', { dtini: ini, dtfim: fim });
    return this.svc.impressaoResumoCC(ini, fim);
  }

  /** o combo de recursos (`PreencheRecurso`) e os níveis de cada modelo (`PreencheCmbNiveisExpandidos`) */
  @Get('opcoes')
  @RequerAcesso('FRMRELCAIXA', 'FRMRELCAIXA')
  async opcoes() {
    return { recursos: await this.svc.recursos(), modelos: MODELOS_CAIXA };
  }
}
