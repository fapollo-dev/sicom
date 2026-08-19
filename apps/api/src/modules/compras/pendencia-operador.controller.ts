import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { pendenciaListarSchema, pendenciaCriarSchema, pendenciaStatusSchema, pendenciaAnaliseSchema,
  analiseCriarSchema, analiseProcessarSchema, type AnaliseCriarDto, type AnaliseProcessarDto,
  analiseLiberarSchema, analiseRefazerSchema, type AnaliseLiberarDto, type AnaliseRefazerDto,
  analisePendenciaAnalistaSchema, analiseDossieSchema, analiseExcluirConferenciaSchema,
  type AnalisePendenciaAnalistaDto, type AnaliseDossieDto, type AnaliseExcluirConferenciaDto,
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
    return this.motor.liberar(dto.apn_id, { fechar_pedido: dto.fechar_pedido, gerar_financeiro: dto.gerar_financeiro, codoperador_comprador: dto.codoperador_comprador });
  }

  /** gera a pendência RPN para o ANALISTA da análise ("Realize uma nova análise…"). */
  @Post('analise/pendencia-analista')
  @HttpCode(200)
  @RequerAcesso('FRMPENDENCIASOPERADOR', 'FRMPENDENCIASOPERADOR')
  analisePendenciaAnalista(@Body(new ZodValidationPipe(analisePendenciaAnalistaSchema)) dto: AnalisePendenciaAnalistaDto) {
    return this.motor.pendenciaAnalista(dto.apn_id);
  }

  /** o dossiê da análise para impressão (cabeçalho + divergentes + só-na-NF + só-no-pedido). */
  @Post('analise/dossie')
  @HttpCode(200)
  @RequerAcesso('FRMPENDENCIASOPERADOR', 'FRMPENDENCIASOPERADOR')
  analiseDossie(@Body(new ZodValidationPipe(analiseDossieSchema)) dto: AnaliseDossieDto) {
    return this.motor.dossie(dto.apn_id);
  }

  /** exclui a conferência da nota (zera o vínculo com o pedido) — exige senha administrativa. */
  @Post('analise/excluir-conferencia')
  @HttpCode(200)
  @RequerAcesso('FRMPENDENCIASOPERADOR', 'FRMPENDENCIASOPERADOR')
  analiseExcluirConferencia(@Body(new ZodValidationPipe(analiseExcluirConferenciaSchema)) dto: AnaliseExcluirConferenciaDto) {
    return this.motor.excluirConferencia(dto);
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
