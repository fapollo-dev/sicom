import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { pendenciaListarSchema, pendenciaCriarSchema, pendenciaStatusSchema, pendenciaAnaliseSchema,
  analiseCriarSchema, analiseProcessarSchema, type AnaliseCriarDto, type AnaliseProcessarDto,
  analiseLiberarSchema, analiseRefazerSchema, type AnaliseLiberarDto, type AnaliseRefazerDto,
  type PendenciaListarDto, type PendenciaCriarDto, type PendenciaStatusDto, type PendenciaAnaliseDto } from '@apollo/shared';
import { PendenciaOperadorService } from './pendencia-operador.service';
import { AnaliseMotorService } from './analise-motor.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** PENDÊNCIAS DO OPERADOR — a única opção real do form no Oracle é o gate da tela. */
@Controller('compras/pendencias')
@UseGuards(AcessoGuard)
export class PendenciaOperadorController {
  constructor(
    private readonly svc: PendenciaOperadorService,
    private readonly motor: AnaliseMotorService,
  ) {}

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

  /** MOTOR (corte-2b): cria a análise dos pedidos × notas escolhidos. */
  @Post('analise/criar')
  @HttpCode(200)
  @RequerAcesso('FRMPENDENCIASOPERADOR', 'FRMPENDENCIASOPERADOR')
  analiseCriar(@Body(new ZodValidationPipe(analiseCriarSchema)) dto: AnaliseCriarDto) {
    return this.motor.criar(dto);
  }

  /** MOTOR: processa (ou reprocessa) a análise, gravando divergências e itens fora de cada lado. */
  @Post('analise/processar')
  @HttpCode(200)
  @RequerAcesso('FRMPENDENCIASOPERADOR', 'FRMPENDENCIASOPERADOR')
  analiseProcessar(@Body(new ZodValidationPipe(analiseProcessarSchema)) dto: AnaliseProcessarDto) {
    return this.motor.processar(dto.apn_id);
  }

  /** LIBERAR: finaliza a análise, encerra a pendência e fecha o pedido (corte-2c). */
  @Post('analise/liberar')
  @HttpCode(200)
  @RequerAcesso('FRMPENDENCIASOPERADOR', 'FRMPENDENCIASOPERADOR')
  analiseLiberar(@Body(new ZodValidationPipe(analiseLiberarSchema)) dto: AnaliseLiberarDto) {
    return this.motor.liberar(dto.apn_id, { fechar_pedido: dto.fechar_pedido, gerar_financeiro: dto.gerar_financeiro });
  }

  /** REFAZER (RPN): nova análise a partir da antiga, já processada. */
  @Post('analise/refazer')
  @HttpCode(200)
  @RequerAcesso('FRMPENDENCIASOPERADOR', 'FRMPENDENCIASOPERADOR')
  analiseRefazer(@Body(new ZodValidationPipe(analiseRefazerSchema)) dto: AnaliseRefazerDto) {
    return this.motor.refazer(dto.apn_id);
  }

  @Post('analise')
  @HttpCode(200)
  @RequerAcesso('FRMPENDENCIASOPERADOR', 'FRMPENDENCIASOPERADOR')
  analise(@Body(new ZodValidationPipe(pendenciaAnaliseSchema)) dto: PendenciaAnaliseDto) {
    return this.svc.analise(dto.apn_id);
  }
}
