import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { lancamentosContabeisSchema, type LancamentosContabeisDto } from '@apollo/shared';
import { LancamentosContabeisService } from './lancamentos-contabeis.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * LANÇAMENTOS CONTÁBEIS (`FRMRELLANCAMENTOSCONTABEIS`) — o razão por lançamento, com a origem pelo nome e a
 * ponte para o documento. RBAC: gate de tela.
 */
@Controller('contabil/lancamentos')
@UseGuards(AcessoGuard)
export class LancamentosContabeisController {
  constructor(private readonly svc: LancamentosContabeisService) {}

  /** o combo de origens, com quantos lançamentos cada uma tem na empresa. */
  @Get('origens')
  @RequerAcesso('FRMRELLANCAMENTOSCONTABEIS', 'FRMRELLANCAMENTOSCONTABEIS')
  origens() {
    return this.svc.origens();
  }

  @Get()
  @RequerAcesso('FRMRELLANCAMENTOSCONTABEIS', 'FRMRELLANCAMENTOSCONTABEIS')
  listar(@Query(new ZodValidationPipe(lancamentosContabeisSchema)) q: LancamentosContabeisDto) {
    return this.svc.listar({
      dataIni: q.dataIni, dataFim: q.dataFim, codorigem: q.codorigem ?? null,
      conta: q.conta ?? null, codoperacao: q.codoperacao ?? null,
      documento: q.documento ?? null, somenteSingle: !!q.somenteSingle,
    });
  }

  /** de um lançamento para o documento que o gerou (o "Detalhar" do legado). */
  @Get(':coddiario/origem')
  @RequerAcesso('FRMRELLANCAMENTOSCONTABEIS', 'FRMRELLANCAMENTOSCONTABEIS')
  origem(@Param('coddiario', ParseIntPipe) coddiario: number) {
    return this.svc.origemDoLancamento(coddiario);
  }
}
