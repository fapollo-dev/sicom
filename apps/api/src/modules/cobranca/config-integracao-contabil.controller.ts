import { Body, Controller, Get, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { configIntegracaoContabilSchema, type ConfigIntegracaoContabilDto } from '@apollo/shared';
import { ConfigIntegracaoContabilService } from './config-integracao-contabil.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CONFIGURAÇÃO DA INTEGRAÇÃO CONTÁBIL (`FRMCONFIGINTEGRACAOCONTABIL`) — RBAC: gate de tela. */
@Controller('contabil/config-integracao')
@UseGuards(AcessoGuard)
export class ConfigIntegracaoContabilController {
  constructor(private readonly svc: ConfigIntegracaoContabilService) {}

  @Get()
  @RequerAcesso('FRMCONFIGINTEGRACAOCONTABIL', 'FRMCONFIGINTEGRACAOCONTABIL')
  obter() {
    return this.svc.obter();
  }

  @Put()
  @HttpCode(200)
  @RequerAcesso('FRMCONFIGINTEGRACAOCONTABIL', 'BTNGRAVAR')
  gravar(
    @Body(new ZodValidationPipe(configIntegracaoContabilSchema)) body: ConfigIntegracaoContabilDto,
    @Req() req: any,
  ) {
    return this.svc.gravar(body, req?.user?.codoperador ?? null);
  }
}
