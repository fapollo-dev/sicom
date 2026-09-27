import { Body, Controller, Get, HttpCode, Post, Put, Query, UseGuards } from '@nestjs/common';
import { liberacaoPermissaoSchema, liberacaoValidarSchema, type LiberacaoPermissaoDto, type LiberacaoValidarDto } from '@apollo/shared';
import { LiberacaoService } from './liberacao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso, RequerSenhaAdministrativa } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * OPERADORES — consulta do LOG_LIBERACOES (auditoria de liberações por supervisor). Corte-1.
 * RBAC: a consulta do log é tela nossa (nenhuma tela do legado com grant o mostra de forma comprovável) — opção
 * própria (FRMLIBERACOES/BTNCONSULTAR), que o admin concede; quem-libera-o-quê são listas nas CONFIGURACOES, e por
 * isso seguem a regra da tela de configurações do legado (senha administrativa).
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
  @RequerSenhaAdministrativa() // as listas USUARIOS_* são CONFIGURACOES: no legado, editadas na tela de configurações
  chaves() {
    return this.svc.chaves();
  }

  /** corte-2: matriz operador × concedido p/ uma chave. */
  @Get('permissoes')
  @RequerSenhaAdministrativa() // as listas USUARIOS_* são CONFIGURACOES: no legado, editadas na tela de configurações
  listarPermissoes(@Query('codigo') codigo: string) {
    return this.svc.listarPermissoes(codigo);
  }

  /** corte-2: concede/revoga o grant de um operador numa chave. */
  @Put('permissoes')
  @HttpCode(200)
  @RequerSenhaAdministrativa() // as listas USUARIOS_* são CONFIGURACOES: no legado, editadas na tela de configurações
  setPermissao(@Body(new ZodValidationPipe(liberacaoPermissaoSchema)) dto: LiberacaoPermissaoDto) {
    return this.svc.setPermissao(dto.codigo, dto.codoperador, dto.concedido);
  }

  /** corte-3: valida login+senha de um SUPERVISOR p/ liberar uma ação (ChamaLiberacaoLogin). Sem @RequerAcesso:
   *  qualquer operador AUTENTICADO pode invocar (é o supervisor que digita as credenciais). */
  @Post('validar')
  @HttpCode(200)
  validar(@Body(new ZodValidationPipe(liberacaoValidarSchema)) dto: LiberacaoValidarDto) {
    return this.svc.validar(dto);
  }
}
