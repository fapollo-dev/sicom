import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { relCartoesSchema, type RelCartoesDto } from '@apollo/shared';
import { RelCartoesService } from './rel-cartoes.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

const filtro = (q: RelCartoesDto) => ({ dataIni: q.dataIni, dataFim: q.dataFim, codoperadora: q.codoperadora ?? null, operadora: q.operadora ?? null,
  modoOperadora: q.modoOperadora ?? null, empresas: q.empresas ?? null });

/** TOTAL POR CARTÃO (`FRMRELCARTOES`) — bruto, líquido e a separação por tipo. RBAC: gate de tela. */
@Controller('relatorios/cartoes')
@UseGuards(AcessoGuard)
export class RelCartoesController {
  constructor(private readonly svc: RelCartoesService) {}

  @Get()
  @RequerAcesso('FRMRELCARTOES', 'FRMRELCARTOES')
  total(@Query(new ZodValidationPipe(relCartoesSchema)) q: RelCartoesDto) {
    return this.svc.total(filtro(q));
  }

  /** a impressão no layout do cliente (`Rel_Total_Cartao.fr3`) */
  @Get('impressao')
  @RequerAcesso('FRMRELCARTOES', 'FRMRELCARTOES')
  impressao(@Query(new ZodValidationPipe(relCartoesSchema)) q: RelCartoesDto) {
    return this.svc.impressao(filtro(q));
  }
}
