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
import { RelVendasDataController } from './rel-vendas-data.controller';
import { RelVendasDataService } from './rel-vendas-data.service';
import { RelVendasDepartamentoController } from './rel-vendas-departamento.controller';
import { RelVendasDepartamentoService } from './rel-vendas-departamento.service';
import { RelVendasHoraController } from './rel-vendas-hora.controller';
import { RelVendasHoraService } from './rel-vendas-hora.service';
import { RelFormasPgtoController } from './rel-formas-pgto.controller';
import { RelFormasPgtoService } from './rel-formas-pgto.service';
import { RelVendasOperadorController } from './rel-vendas-operador.controller';
import { RelVendasOperadorService } from './rel-vendas-operador.service';
import { RelCaixaOpsController } from './rel-caixa-ops.controller';
import { RelCaixaOpsService } from './rel-caixa-ops.service';
import { ConfigService } from '../cadastro/config.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

/**
 * RELATÓRIOS — categoria nova no app (o legado tem dezenas). Migrados: Relatório de Vendas (rel 01) e
 * Prévia do Fornecedor / Análise de Giro (15 dias).
 */
@Module({
  controllers: [RelVendasController, PreviaFornecedorController, RelFinalizadorasController, RelTicketMedioController, RelCaixaDreController, RelSemMovimentoController, RelCurvaAbcController, RelVendasDataController, RelVendasDepartamentoController, RelVendasHoraController, RelFormasPgtoController, RelVendasOperadorController, RelCaixaOpsController],
  providers: [RelVendasService, PreviaFornecedorService, RelFinalizadorasService, RelTicketMedioService, RelCaixaDreService, RelSemMovimentoService, RelCurvaAbcService, RelVendasDataService, RelVendasDepartamentoService, RelVendasHoraService, RelFormasPgtoService, RelVendasOperadorService, RelCaixaOpsService, ConfigService, DatabaseProvider],
})
export class RelatoriosModule {}
