import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { registroEsSchema, type RegistroEsDto } from '@apollo/shared';
import { RegistroEsService } from './registro-es.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** REGISTRO DE ENTRADAS / SAÍDAS (FRMRELREGISTROS_ES, menus 186/187): a consulta das notas e o livro impresso. */
@Controller('fiscal/registro-es')
@UseGuards(AcessoGuard)
export class RegistroEsController {
  constructor(private readonly svc: RegistroEsService) {}

  @Post('consultar')
  @HttpCode(200)
  @RequerAcesso('FRMRELREGISTROS_ES', 'FRMRELREGISTROS_ES')
  consultar(@Body(new ZodValidationPipe(registroEsSchema)) dto: RegistroEsDto) {
    return this.svc.consultar(dto);
  }

  @Get('impressao')
  @RequerAcesso('FRMRELREGISTROS_ES', 'FRMRELREGISTROS_ES')
  impressao(@Query(new ZodValidationPipe(registroEsSchema)) dto: RegistroEsDto) {
    return this.svc.impressao(dto);
  }
}
