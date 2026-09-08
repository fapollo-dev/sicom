import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CadastroModule } from './modules/cadastro/cadastro.module';
import { CobrancaModule } from './modules/cobranca/cobranca.module';
import { ComprasModule } from './modules/compras/compras.module';
import { RelatoriosModule } from './modules/relatorios/relatorios.module';
import { PrecificacaoModule } from './modules/precificacao/precificacao.module';
import { AuthModule } from './modules/auth/auth.module';
import { SpedModule } from './modules/sped/sped.module';
import { HealthController } from './health.controller';
import { TenantMiddleware } from './shared/tenant/tenant.middleware';
import { AcessoModule } from './shared/acesso/acesso.module';
import { CrudModule } from './shared/crud/crud.module';

@Module({
  imports: [
    AcessoModule, CrudModule, AuthModule, CadastroModule, CobrancaModule, ComprasModule, PrecificacaoModule,
    SpedModule,
    RelatoriosModule, // categoria RELATÓRIOS (1º migrado: Relatório de Vendas)
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Tenant resolvido nas rotas de domínio + 'auth' (o login precisa do tenantId do header p/ achar o banco;
    // as demais rotas de auth extraem o operador do JWT). /healthz fica livre (infra).
    // ⚠️ prefixo NOVO exige entrada aqui: sem ela o `currentTenant()` estoura TENANT_CONTEXT_MISSING e a rota
    // devolve 500 — foi o que aconteceu ao abrir 'contabil' (integração contábil do FRMTRON).
    consumer.apply(TenantMiddleware).forRoutes('auth', 'cadastro', 'cobranca', 'compras', 'precificacao', 'fiscal', 'contabil', 'operadores', 'relatorios');
  }
}
