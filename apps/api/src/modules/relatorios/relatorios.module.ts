import { Module } from '@nestjs/common';
import { RelVendasController } from './rel-vendas.controller';
import { RelVendasService } from './rel-vendas.service';
import { PreviaFornecedorController } from './previa-fornecedor.controller';
import { PreviaFornecedorService } from './previa-fornecedor.service';
import { RelFinalizadorasController } from './rel-finalizadoras.controller';
import { RelFinalizadorasService } from './rel-finalizadoras.service';
import { RelTicketMedioController } from './rel-ticket-medio.controller';
import { RelTicketMedioService } from './rel-ticket-medio.service';
import { RelCaixaDreController } from './rel-caixa-dre.controller';
import { RelCaixaDreService } from './rel-caixa-dre.service';
import { RelSemMovimentoController } from './rel-sem-movimento.controller';
import { RelSemMovimentoService } from './rel-sem-movimento.service';
import { RelCurvaAbcController } from './rel-curva-abc.controller';
import { RelCurvaAbcService } from './rel-curva-abc.service';
import { ConfigService } from '../cadastro/config.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

/**
 * RELATÓRIOS — categoria nova no app (o legado tem dezenas). Migrados: Relatório de Vendas (rel 01) e
 * Prévia do Fornecedor / Análise de Giro (15 dias).
 */
@Module({
  controllers: [RelVendasController, PreviaFornecedorController, RelFinalizadorasController, RelTicketMedioController, RelCaixaDreController, RelSemMovimentoController, RelCurvaAbcController],
  providers: [RelVendasService, PreviaFornecedorService, RelFinalizadorasService, RelTicketMedioService, RelCaixaDreService, RelSemMovimentoService, RelCurvaAbcService, ConfigService, DatabaseProvider],
})
export class RelatoriosModule {}
