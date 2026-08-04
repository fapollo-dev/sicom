import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relFinalizadorasSchema, type RelFinalizadorasDto } from '@apollo/shared';
import { RelFinalizadorasService } from './rel-finalizadoras.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * VENDAS E FINALIZADORAS (FRMRELFINALIZADORAS). RBAC: o gate do botão CONSULTA — é a opção que o legado
 * permissiona para gerar (a tela tem as duas: FRMRELFINALIZADORAS e BTNCONSULTA).
 */
@Controller('relatorios/finalizadoras')
@UseGuards(AcessoGuard)
export class RelFinalizadorasController {
  constructor(private readonly svc: RelFinalizadorasService) {}

  @Post('consultar')
  @HttpCode(200)
  @RequerAcesso('FRMRELFINALIZADORAS', 'BTNCONSULTA')
  consultar(@Body(new ZodValidationPipe(relFinalizadorasSchema)) dto: RelFinalizadorasDto) {
    return this.svc.consultar(dto);
  }
}
