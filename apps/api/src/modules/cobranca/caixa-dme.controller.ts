import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { caixaDmeSchema, type CaixaDmeDto } from '@apollo/shared';
import { CaixaDmeService } from './caixa-dme.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CAIXA DME (`FRMRELATORIOCAIXADME`) — RBAC: gate de tela. */
@Controller('cobranca/caixa-dme')
@UseGuards(AcessoGuard)
export class CaixaDmeController {
  constructor(private readonly svc: CaixaDmeService) {}

  @Get()
  @RequerAcesso('FRMRELATORIOCAIXADME', 'FRMRELATORIOCAIXADME')
  gerar(@Query(new ZodValidationPipe(caixaDmeSchema)) q: CaixaDmeDto) { return this.svc.gerar(q); }
}
