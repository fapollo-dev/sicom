import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relFormasPgtoSchema, type RelFormasPgtoDto } from '@apollo/shared';
import { RelFormasPgtoService } from './rel-formas-pgto.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** GRÁFICO DE FORMAS DE PAGAMENTO (rel 08 do hub). RBAC: o mesmo gate do hub — semeado na mig 130. */
@Controller('relatorios/formas-pgto')
@UseGuards(AcessoGuard)
export class RelFormasPgtoController {
  constructor(private readonly svc: RelFormasPgtoService) {}

  @Post('consultar')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  consultar(@Body(new ZodValidationPipe(relFormasPgtoSchema)) dto: RelFormasPgtoDto) {
    return this.svc.consultar(dto);
  }
}
