import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

/** AUTH (OPERADORES corte-3a) — login/troca-de-senha/me/logout. Provê o DatabaseProvider localmente (o
 *  CrudModule global só exporta os engines), como os demais módulos verticais (compras/cadastro). */
@Module({
  controllers: [AuthController],
  providers: [AuthService, DatabaseProvider],
})
export class AuthModule {}
