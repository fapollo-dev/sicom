import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relCaixaDreSchema, type RelCaixaDreDto } from '@apollo/shared';
import { RelCaixaDreService } from './rel-caixa-dre.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CAIXA D.R.E. (FRMRELATORIOCAIXA) — RBAC: gate de tela (a opção do form no Oracle). */
@Controller('relatorios/caixa-dre')
@UseGuards(AcessoGuard)
export class RelCaixaDreController {
  constructor(private readonly svc: RelCaixaDreService) {}

  @Post('consultar')
  @HttpCode(200)
  @RequerAcesso('FRMRELATORIOCAIXA', 'FRMRELATORIOCAIXA')
  consultar(@Body(new ZodValidationPipe(relCaixaDreSchema)) dto: RelCaixaDreDto) {
    return this.svc.consultar(dto);
  }
}
