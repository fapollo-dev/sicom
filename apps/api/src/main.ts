import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared/errors/all-exceptions.filter';

/**
 * Bootstrap: um binário, dois papéis (APP_ROLE=web|worker).
 * Nesta fatia só o papel `web`; o `worker` (BullMQ) entra na Fase 0 posterior.
 */
async function bootstrap() {
  const role = process.env.APP_ROLE ?? 'web';
  if (role === 'worker') {
    console.log('[api] worker role ainda não implementado nesta fatia');
    return;
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
  // Import de XML da NFe: uma NFe real (dezenas de itens) passa fácil do default 100 KB do body-parser.
  // Sobe o teto do JSON p/ 5 MB (reconfigura o parser embutido do Nest/Express).
  app.useBodyParser('json', { limit: '5mb' });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`[api] web ouvindo em http://localhost:${port}`);
}

bootstrap();
