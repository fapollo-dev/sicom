import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CadastroModule } from './modules/cadastro/cadastro.module';
import { CobrancaModule } from './modules/cobranca/cobranca.module';
import { ComprasModule } from './modules/compras/compras.module';
import { PrecificacaoModule } from './modules/precificacao/precificacao.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthController } from './health.controller';
import { TenantMiddleware } from './shared/tenant/tenant.middleware';
import { AcessoModule } from './shared/acesso/acesso.module';
import { CrudModule } from './shared/crud/crud.module';

@Module({
  imports: [AcessoModule, CrudModule, AuthModule, CadastroModule, CobrancaModule, ComprasModule, PrecificacaoModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Tenant resolvido nas rotas de domínio + 'auth' (o login precisa do tenantId do header p/ achar o banco;
    // as demais rotas de auth extraem o operador do JWT). /healthz fica livre (infra).
    consumer.apply(TenantMiddleware).forRoutes('auth', 'cadastro', 'cobranca', 'compras', 'precificacao', 'fiscal');
  }
}
