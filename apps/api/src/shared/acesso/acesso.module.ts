import { Global, Module } from '@nestjs/common';
import { AcessoService } from './acesso.service';
import { AcessoGuard } from './acesso.guard';
import { DatabaseProvider } from '../database/database.provider';

/** RBAC global: AcessoService + AcessoGuard disponíveis a todos os módulos. */
@Global()
@Module({
  providers: [AcessoService, AcessoGuard, DatabaseProvider],
  exports: [AcessoService, AcessoGuard],
})
export class AcessoModule {}
