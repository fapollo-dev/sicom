import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relCurvaAbcSchema, type RelCurvaAbcDto } from '@apollo/shared';
import { RelCurvaAbcService } from './rel-curva-abc.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CURVA ABC DE PRODUTOS VENDIDOS (rel 09 do hub). RBAC: o mesmo gate do hub — semeado na mig 130. */
@Controller('relatorios/curva-abc')
@UseGuards(AcessoGuard)
export class RelCurvaAbcController {
  constructor(private readonly svc: RelCurvaAbcService) {}

  @Post('consultar')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  consultar(@Body(new ZodValidationPipe(relCurvaAbcSchema)) dto: RelCurvaAbcDto) {
    return this.svc.consultar(dto);
  }

  /** rel 18 — ranking por quantidade (o .fr3 não classifica nada; ver o serviço). */
  @Post('quantidade')
  @HttpCode(200)
  @RequerAcesso('FRMRELVENDAS', 'FRMRELVENDAS')
  quantidade(@Body(new ZodValidationPipe(relCurvaAbcSchema)) dto: RelCurvaAbcDto) {
    return this.svc.quantidade(dto);
  }
}
