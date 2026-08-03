import { Module } from '@nestjs/common';
import { RelVendasController } from './rel-vendas.controller';
import { RelVendasService } from './rel-vendas.service';
import { ConfigService } from '../cadastro/config.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

/** RELATÓRIOS — categoria nova no app (o legado tem dezenas; o 1º migrado é o Relatório de Vendas). */
@Module({
  controllers: [RelVendasController],
  providers: [RelVendasService, ConfigService, DatabaseProvider],
})
export class RelatoriosModule {}
