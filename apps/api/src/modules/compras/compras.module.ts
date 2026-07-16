import { Module } from '@nestjs/common';
import { PedidoCompraAggregateController } from './pedido-compra.aggregate';
import { PedidoCompraController } from './pedido-compra.controller';
import { CondicoesPagtoCrudController } from './condicoes-pagto.crud';
import { ImportacaoNfeController } from './importacao-nfe.controller';
import { PedidoCompraService } from './pedido-compra.service';
import { RecebimentoService } from './recebimento.service';
import { DevolucaoCompraAggregateController } from './devolucao-compra.aggregate';
import { DevolucaoCompraController } from './devolucao-compra.controller';
import { DevolucaoCompraService } from './devolucao-compra.service';
import { DeParaController } from './de-para.controller';
import { DeParaService } from './de-para.service';
import { AnalisePedidoNfService } from './analise-pedido-nf.service';
import { AnalisePedidoNfController } from './analise-pedido-nf.controller';
import { CadastroModule } from '../cadastro/cadastro.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseProvider } from '../../shared/database/database.provider';

/**
 * COMPRAS — módulo do ciclo de compras. Corte-1: PEDIDO DE COMPRA (a MAIOR tela do legado), agregado
 * mestre-detalhe (CRUD via AggregateEngineService, path `compras/pedidos`) + vertical de estado
 * (fechar/reabrir). O AggregateEngineService vem do CrudModule (@Global). Sem efeitos (o pedido é
 * intenção; o FATO nasce na NF de entrada — corte futuro).
 */
@Module({
  imports: [CadastroModule, AuthModule], // Cadastro=NfFaturamento/Config; Auth=LiberacaoService (wire do limite E8 c3). Acíclico.
  controllers: [
    PedidoCompraAggregateController, // engine MESTRE-DETALHE (CRUD do pedido: header + itens; sem efeitos)
    PedidoCompraController, // vertical (fechar/reabrir + gerar parcelas + gerar NF de entrada — recebimento)
    CondicoesPagtoCrudController, // corte-2: cadastral GLOBAL de condições de pagamento (lookup do pedido)
    ImportacaoNfeController, // recebimento corte-2 (import do XML da NFe → NF de entrada valorada)
    // VERTICAL antes do agregado: a rota estática GET `itens-disponiveis` tem de ser registrada ANTES do
    // GET `:id` do agregado (senão o :id captura 'itens-disponiveis'). Ordem de registro = precedência (Express).
    DevolucaoCompraController, // vertical: picker de saldo + finalizar/reabrir/cancelar (sem efeitos)
    DevolucaoCompraAggregateController, // devolução de compra corte-1: CRUD do documento (header + itens)
    DeParaController, // de-para de fornecedor (CODREFERENCIA_FOR) — manutenção standalone (recebimento corte-5)
    AnalisePedidoNfController, // Wave 4 corte-2: Análise Pedido×NF (divergências + liberação por supervisor)
  ],
  providers: [PedidoCompraService, RecebimentoService, DevolucaoCompraService, DeParaService, AnalisePedidoNfService, DatabaseProvider],
})
export class ComprasModule {}
