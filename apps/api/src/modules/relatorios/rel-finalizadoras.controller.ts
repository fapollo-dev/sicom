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

  /** o Enter numa célula de forma de pagamento (dbgDadosKeyDown): os títulos do dia — A Receber, Cheques ou Cartões, pela DESTINO */
  @Post('detalhe')
  @HttpCode(200)
  @RequerAcesso('FRMRELFINALIZADORAS', 'BTNCONSULTA')
  detalhe(@Body() body: { data?: string; modalidade?: string; empresas?: unknown }) {
    const empresas = Array.isArray(body?.empresas) ? body.empresas.map((e) => Number(e)).filter((e) => Number.isInteger(e) && e > 0) : undefined;
    return this.svc.detalhe({ data: body?.data, modalidade: body?.modalidade, empresas });
  }

  /** o "Imprimir": Rel_Finalizadoras.fr3 (horizontal, colunas por forma) ou Rel_Finalizadoras_Vertical.fr3 */
  @Post('impressao')
  @HttpCode(200)
  @RequerAcesso('FRMRELFINALIZADORAS', 'BTNCONSULTA')
  impressao(@Body(new ZodValidationPipe(relFinalizadorasSchema)) dto: RelFinalizadorasDto) {
    return this.svc.impressao(dto, !!dto.vertical);
  }
}
