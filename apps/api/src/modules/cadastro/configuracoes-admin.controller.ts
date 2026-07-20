import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query, UseGuards } from '@nestjs/common';
import { configOverrideSchema, configDefaultSchema, ESCOPO_CONFIG, type EscopoConfig } from '@apollo/shared';
import { ConfiguracoesAdminService } from './configuracoes-admin.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * CONFIGURAÇÕES (gestão) — tela UConfigura. Leitura livre (catálogo + valor efetivo); escrita (override/
 * default) exige RBAC FRMCONFIGURA/BTNGRAVAR. `:codigo` é a chave natural (sem barras).
 */
@Controller('cadastro/configuracoes')
@UseGuards(AcessoGuard)
export class ConfiguracoesAdminController {
  constructor(private readonly svc: ConfiguracoesAdminService) {}

  @Get()
  list() {
    return this.svc.listar();
  }

  @Get(':codigo/overrides')
  @RequerAcesso('FRMCONFIGURA', 'BTNGRAVAR')
  overrides(@Param('codigo') codigo: string) {
    return this.svc.overrides(codigo);
  }

  @Put(':codigo/override')
  @RequerAcesso('FRMCONFIGURA', 'BTNGRAVAR')
  setOverride(@Param('codigo') codigo: string, @Body(new ZodValidationPipe(configOverrideSchema)) dto: { tipo: EscopoConfig; chave: string; valor: string }) {
    return this.svc.setOverride(codigo, dto);
  }

  @Delete(':codigo/override')
  @RequerAcesso('FRMCONFIGURA', 'BTNGRAVAR')
  @HttpCode(204)
  removerOverride(@Param('codigo') codigo: string, @Query('tipo') tipo: string, @Query('chave') chave: string) {
    if (!ESCOPO_CONFIG.includes(tipo as EscopoConfig)) throw new BusinessRuleError('CONFIG_ESCOPO_NAO_PERMITIDO', { tipo });
    if (!chave) throw new BusinessRuleError('VALIDACAO', { campo: 'chave' });
    return this.svc.removerOverride(codigo, tipo as EscopoConfig, chave);
  }

  @Put(':codigo')
  @RequerAcesso('FRMCONFIGURA', 'BTNGRAVAR')
  setDefault(@Param('codigo') codigo: string, @Body(new ZodValidationPipe(configDefaultSchema)) dto: { valor: string }) {
    return this.svc.setDefault(codigo, dto.valor);
  }
}
