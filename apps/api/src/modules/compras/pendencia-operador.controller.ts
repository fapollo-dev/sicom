import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { pendenciaListarSchema, pendenciaCriarSchema, pendenciaStatusSchema, pendenciaAnaliseSchema,
  type PendenciaListarDto, type PendenciaCriarDto, type PendenciaStatusDto, type PendenciaAnaliseDto } from '@apollo/shared';
import { PendenciaOperadorService } from './pendencia-operador.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** PENDÊNCIAS DO OPERADOR — a única opção real do form no Oracle é o gate da tela. */
@Controller('compras/pendencias')
@UseGuards(AcessoGuard)
export class PendenciaOperadorController {
  constructor(private readonly svc: PendenciaOperadorService) {}

  @Post('listar')
  @HttpCode(200)
  @RequerAcesso('FRMPENDENCIASOPERADOR', 'FRMPENDENCIASOPERADOR')
  listar(@Body(new ZodValidationPipe(pendenciaListarSchema)) dto: PendenciaListarDto) {
    return this.svc.listar(dto);
  }

  @Post('criar')
  @HttpCode(200)
  @RequerAcesso('FRMPENDENCIASOPERADOR', 'FRMPENDENCIASOPERADOR')
  criar(@Body(new ZodValidationPipe(pendenciaCriarSchema)) dto: PendenciaCriarDto) {
    return this.svc.criar(dto);
  }

  @Post('status')
  @HttpCode(200)
  @RequerAcesso('FRMPENDENCIASOPERADOR', 'FRMPENDENCIASOPERADOR')
  status(@Body(new ZodValidationPipe(pendenciaStatusSchema)) dto: PendenciaStatusDto) {
    return this.svc.status(dto.po_id, dto.finalizar, dto.observacao);
  }

  @Post('analise')
  @HttpCode(200)
  @RequerAcesso('FRMPENDENCIASOPERADOR', 'FRMPENDENCIASOPERADOR')
  analise(@Body(new ZodValidationPipe(pendenciaAnaliseSchema)) dto: PendenciaAnaliseDto) {
    return this.svc.analise(dto.apn_id);
  }
}
