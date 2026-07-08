import { Module } from '@nestjs/common';
import { PedidoCompraAggregateController } from './pedido-compra.aggregate';
import { PedidoCompraController } from './pedido-compra.controller';
import { ImportacaoNfeController } from './importacao-nfe.controller';
import { PedidoCompraService } from './pedido-compra.service';
import { RecebimentoService } from './recebimento.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

/**
 * COMPRAS — módulo do ciclo de compras. Corte-1: PEDIDO DE COMPRA (a MAIOR tela do legado), agregado
 * mestre-detalhe (CRUD via AggregateEngineService, path `compras/pedidos`) + vertical de estado
 * (fechar/reabrir). O AggregateEngineService vem do CrudModule (@Global). Sem efeitos (o pedido é
 * intenção; o FATO nasce na NF de entrada — corte futuro).
 */
@Module({
  controllers: [
    PedidoCompraAggregateController, // engine MESTRE-DETALHE (CRUD do pedido: header + itens; sem efeitos)
    PedidoCompraController, // vertical (fechar/reabrir + gerar NF de entrada — recebimento)
    ImportacaoNfeController, // recebimento corte-2 (import do XML da NFe → NF de entrada valorada)
  ],
  providers: [PedidoCompraService, RecebimentoService, DatabaseProvider],
})
export class ComprasModule {}
