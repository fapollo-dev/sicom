import { Module } from '@nestjs/common';
import { PedidoCompraAggregateController } from './pedido-compra.aggregate';
import { PedidoCompraController } from './pedido-compra.controller';
import { CondicoesPagtoCrudController } from './condicoes-pagto.crud';
import { ImportacaoNfeController } from './importacao-nfe.controller';
import { PedidoCompraService } from './pedido-compra.service';
import { RecebimentoService } from './recebimento.service';
import { CadastroModule } from '../cadastro/cadastro.module';
import { DatabaseProvider } from '../../shared/database/database.provider';

/**
 * COMPRAS — módulo do ciclo de compras. Corte-1: PEDIDO DE COMPRA (a MAIOR tela do legado), agregado
 * mestre-detalhe (CRUD via AggregateEngineService, path `compras/pedidos`) + vertical de estado
 * (fechar/reabrir). O AggregateEngineService vem do CrudModule (@Global). Sem efeitos (o pedido é
 * intenção; o FATO nasce na NF de entrada — corte futuro).
 */
@Module({
  imports: [CadastroModule], // reusa NfFaturamentoService (A Pagar das duplicatas do XML — corte-4). Acíclico.
  controllers: [
    PedidoCompraAggregateController, // engine MESTRE-DETALHE (CRUD do pedido: header + itens; sem efeitos)
    PedidoCompraController, // vertical (fechar/reabrir + gerar parcelas + gerar NF de entrada — recebimento)
    CondicoesPagtoCrudController, // corte-2: cadastral GLOBAL de condições de pagamento (lookup do pedido)
    ImportacaoNfeController, // recebimento corte-2 (import do XML da NFe → NF de entrada valorada)
  ],
  providers: [PedidoCompraService, RecebimentoService, DatabaseProvider],
})
export class ComprasModule {}
