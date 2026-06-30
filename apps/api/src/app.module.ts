import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CadastroModule } from './modules/cadastro/cadastro.module';
import { CobrancaModule } from './modules/cobranca/cobranca.module';
import { PrecificacaoModule } from './modules/precificacao/precificacao.module';
import { HealthController } from './health.controller';
import { TenantMiddleware } from './shared/tenant/tenant.middleware';
import { AcessoModule } from './shared/acesso/acesso.module';
import { CrudModule } from './shared/crud/crud.module';

@Module({
  imports: [AcessoModule, CrudModule, CadastroModule, CobrancaModule, PrecificacaoModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Tenant resolvido nas rotas de domínio; /healthz fica livre (infra).
    consumer.apply(TenantMiddleware).forRoutes('cadastro', 'cobranca', 'precificacao', 'fiscal');
  }
}
