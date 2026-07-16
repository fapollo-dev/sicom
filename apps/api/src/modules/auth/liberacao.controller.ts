import { Body, Controller, Get, HttpCode, Put, Query, UseGuards } from '@nestjs/common';
import { liberacaoPermissaoSchema, type LiberacaoPermissaoDto } from '@apollo/shared';
import { LiberacaoService } from './liberacao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * OPERADORES — consulta do LOG_LIBERACOES (auditoria de liberações por supervisor). Corte-1.
 * O registro de eventos é feito por dentro (LiberacaoService.registrar, chamado pelo validar/wire do corte-3).
 */
@Controller('operadores/liberacoes')
@UseGuards(AcessoGuard)
export class LiberacaoController {
  constructor(private readonly svc: LiberacaoService) {}

  @Get()
  @RequerAcesso('FRMLIBERACOES', 'BTNCONSULTAR')
  listar(@Query('dataInicial') dataInicial?: string, @Query('dataFinal') dataFinal?: string, @Query('liberacao') liberacao?: string) {
    return this.svc.listar({ dataInicial, dataFinal, liberacao });
  }

  /** corte-2: as chaves de liberação gerenciáveis (seletor da tela de grants). */
  @Get('chaves')
  @RequerAcesso('FRMLIBERACOES', 'BTNPERMISSOES')
  chaves() {
    return this.svc.chaves();
  }

  /** corte-2: matriz operador × concedido p/ uma chave. */
  @Get('permissoes')
  @RequerAcesso('FRMLIBERACOES', 'BTNPERMISSOES')
  listarPermissoes(@Query('codigo') codigo: string) {
    return this.svc.listarPermissoes(codigo);
  }

  /** corte-2: concede/revoga o grant de um operador numa chave. */
  @Put('permissoes')
  @HttpCode(200)
  @RequerAcesso('FRMLIBERACOES', 'BTNPERMISSOES')
  setPermissao(@Body(new ZodValidationPipe(liberacaoPermissaoSchema)) dto: LiberacaoPermissaoDto) {
    return this.svc.setPermissao(dto.codigo, dto.codoperador, dto.concedido);
  }
}
