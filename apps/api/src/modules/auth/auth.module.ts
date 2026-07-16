import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LiberacaoController } from './liberacao.controller';
import { LiberacaoService } from './liberacao.service';
import { ConfigService } from '../cadastro/config.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

/** AUTH (OPERADORES corte-3a) — login/troca-de-senha/me/logout + LIBERAÇÃO por supervisor (§29, corte-1:
 *  log_liberacoes + consulta). Provê o DatabaseProvider localmente (o CrudModule global só exporta os engines). */
@Module({
  controllers: [AuthController, LiberacaoController],
  providers: [AuthService, LiberacaoService, ConfigService, DatabaseProvider],
  exports: [LiberacaoService], // reusado no corte-3 (wire do limite do pedido de compra)
})
export class AuthModule {}
