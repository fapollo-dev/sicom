import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  aplicarMultSchema, filtroProdutosMultSchema, pisCofinsMultSchema, simularMultSchema,
  type FiltroProdutosMultDto, type PisCofinsMultDto, type SimularMultDto,
} from '@apollo/shared';
import { MultAtualizacaoService } from './mult-atualizacao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * ATUALIZAÇÃO AUTOMÁTICA DE PRODUTOS (`FRMMULTATUALIZACAO`).
 * Buscar e **simular** passam pelo gate de tela; **gravar** exige `BTNGRAVAR` — é o que escreve em N produtos.
 */
@Controller('cadastro/mult-atualizacao')
@UseGuards(AcessoGuard)
export class MultAtualizacaoController {
  constructor(private readonly svc: MultAtualizacaoService) {}

  private operador(req: { user?: { codoperador?: number } }): number | null {
    return req?.user?.codoperador ?? null;
  }

  @Get('produtos')
  @RequerAcesso('FRMMULTATUALIZACAO', 'FRMMULTATUALIZACAO')
  buscar(@Query(new ZodValidationPipe(filtroProdutosMultSchema)) q: FiltroProdutosMultDto) {
    return this.svc.buscar(q);
  }

  /** a prévia: a mesma conta da gravação, sem tocar no banco. É o botão "Alterar" do legado. */
  @Post('simular')
  @HttpCode(200)
  @RequerAcesso('FRMMULTATUALIZACAO', 'FRMMULTATUALIZACAO')
  simular(@Body(new ZodValidationPipe(simularMultSchema)) body: SimularMultDto) {
    return this.svc.simular(body);
  }

  @Post('aplicar')
  @HttpCode(200)
  @RequerAcesso('FRMMULTATUALIZACAO', 'BTNGRAVAR')
  aplicar(@Body(new ZodValidationPipe(aplicarMultSchema)) body: SimularMultDto, @Req() req: any) {
    return this.svc.aplicar(body, this.operador(req));
  }

  @Post('pis-cofins')
  @HttpCode(200)
  @RequerAcesso('FRMMULTATUALIZACAO', 'BTNGRAVAR')
  pisCofins(@Body(new ZodValidationPipe(pisCofinsMultSchema)) body: PisCofinsMultDto, @Req() req: any) {
    return this.svc.aplicarPisCofins(body, this.operador(req));
  }
}
