import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { startEmbeddedPg, PG_CONN } from '../test/embedded-db';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';

/**
 * Servidor de DESENVOLVIMENTO persistente: sobe o Postgres embarcado (migrations +
 * seed de todas as telas) e a API NestJS real na porta 3000 (o BASE padrão do web),
 * com CORS ligado p/ o Vite (5173). Fica no ar até Ctrl+C. Não é produção.
 */
const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  console.log('[dev] iniciando Postgres embarcado (migrations + seed)...');
  const pg = await startEmbeddedPg();
  process.env.PGHOST = PG_CONN.host;
  process.env.PGPORT = String(PG_CONN.port);
  process.env.PGUSER = PG_CONN.user;
  process.env.PGPASSWORD = PG_CONN.password;
  process.env.PG_TENANT_PREFIX = PG_CONN.databasePrefix;

  const app = await NestFactory.create(AppModule, { cors: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(PORT);
  console.log(`[dev] API no ar em http://localhost:${PORT}  (tenant via headers x-tenant-id/x-operador-id/x-empresa-id)`);
  console.log('[dev] telas: /cadastro/{bancos,marcas,bairros,precos,ncm,cidades} · /cobranca/lotes-md');

  const parar = async () => {
    console.log('\n[dev] encerrando...');
    await app.close();
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', parar);
  process.on('SIGTERM', parar);
}

main().catch((e) => {
  console.error('[dev] erro', e);
  process.exitCode = 1;
});
