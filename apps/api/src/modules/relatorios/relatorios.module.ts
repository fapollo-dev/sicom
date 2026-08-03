import { Module } from '@nestjs/common';
import { RelVendasController } from './rel-vendas.controller';
import { RelVendasService } from './rel-vendas.service';
import { PreviaFornecedorController } from './previa-fornecedor.controller';
import { PreviaFornecedorService } from './previa-fornecedor.service';
import { ConfigService } from '../cadastro/config.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

/**
 * RELATÓRIOS — categoria nova no app (o legado tem dezenas). Migrados: Relatório de Vendas (rel 01) e
 * Prévia do Fornecedor / Análise de Giro (15 dias).
 */
@Module({
  controllers: [RelVendasController, PreviaFornecedorController],
  providers: [RelVendasService, PreviaFornecedorService, ConfigService, DatabaseProvider],
})
export class RelatoriosModule {}
