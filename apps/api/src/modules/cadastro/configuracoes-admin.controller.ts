import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query, UseGuards } from '@nestjs/common';
import { configOverrideSchema, configDefaultSchema, ESCOPO_CONFIG, type EscopoConfig } from '@apollo/shared';
import { ConfiguracoesAdminService } from './configuracoes-admin.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerSenhaAdministrativa } from '../../shared/acesso/requer-acesso.decorator';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * CONFIGURAÇÕES (gestão) — tela UConfigura. No legado a tela não usa PERMISSOES: pede a senha administrativa
 * (`TdmPrincipal.TelaConfiguracao` → `SenhaAdministrativa('ADM')`) e barra DESABILITA_OPERACOES_BASICAS — daí
 * `@RequerSenhaAdministrativa` em tudo, inclusive no catálogo (a tela inteira fica atrás da senha).
 * `:codigo` é a chave natural (sem barras).
 */
@Controller('cadastro/configuracoes')
@UseGuards(AcessoGuard)
export class ConfiguracoesAdminController {
  constructor(private readonly svc: ConfiguracoesAdminService) {}

  @Get()
  @RequerSenhaAdministrativa()
  list() {
    return this.svc.listar();
  }

  @Get(':codigo/overrides')
  @RequerSenhaAdministrativa()
  overrides(@Param('codigo') codigo: string) {
    return this.svc.overrides(codigo);
  }

  @Put(':codigo/override')
  @RequerSenhaAdministrativa()
  setOverride(@Param('codigo') codigo: string, @Body(new ZodValidationPipe(configOverrideSchema)) dto: { tipo: EscopoConfig; chave: string; valor: string }) {
    return this.svc.setOverride(codigo, dto);
  }

  @Delete(':codigo/override')
  @RequerSenhaAdministrativa()
  @HttpCode(204)
  removerOverride(@Param('codigo') codigo: string, @Query('tipo') tipo: string, @Query('chave') chave: string) {
    if (!ESCOPO_CONFIG.includes(tipo as EscopoConfig)) throw new BusinessRuleError('CONFIG_ESCOPO_NAO_PERMITIDO', { tipo });
    if (!chave) throw new BusinessRuleError('VALIDACAO', { campo: 'chave' });
    return this.svc.removerOverride(codigo, tipo as EscopoConfig, chave);
  }

  @Put(':codigo')
  @RequerSenhaAdministrativa()
  setDefault(@Param('codigo') codigo: string, @Body(new ZodValidationPipe(configDefaultSchema)) dto: { valor: string }) {
    return this.svc.setDefault(codigo, dto.valor);
  }
}
