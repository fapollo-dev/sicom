import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { BancosCadMaster } from '../features/cadastro-bancos/BancosCadMaster';
import { MarcasCadMaster } from '../features/marcas/MarcasCadMaster';
import { BairrosCadMaster } from '../features/bairros/BairrosCadMaster';
import { CidadesCadMaster } from '../features/cidades/CidadesCadMaster';
import { PrecosCadMaster } from '../features/precos/PrecosCadMaster';
import { NcmCadMaster } from '../features/ncm/NcmCadMaster';
import { CfopCadMaster } from '../features/cfop/CfopCadMaster';
import { OperacoesContaCadMaster } from '../features/operacoes-conta/OperacoesContaCadMaster';
import { ContasBancariasCadMaster } from '../features/contas-bancarias/ContasBancariasCadMaster';
import { LotesCobrancaCadMaster } from '../features/lotes-md/LotesCobrancaCadMaster';
import { ContasReceberCadMaster } from '../features/areceber/ContasReceberCadMaster';
import { ContasPagarCadMaster } from '../features/apagar/ContasPagarCadMaster';
import { PlanoContasCadMaster } from '../features/plano-contas/PlanoContasCadMaster';
import { DreRelatorio } from '../features/dre/DreRelatorio';
import { RazaoRelatorio } from '../features/razao/RazaoRelatorio';
import { CaixaPage } from '../features/caixa/CaixaPage';
import { OperadoresCadMaster } from '../features/operadores/OperadoresCadMaster';
import { FormasPgtoCadMaster } from '../features/formas-pgto/FormasPgtoCadMaster';
import { ParceirosCadMaster } from '../features/parceiros/ParceirosCadMaster';
import { ProdutoCadMaster } from '../features/produtos/ProdutoCadMaster';
import { NfCadMaster } from '../features/nf/NfCadMaster';
import { PedidoCompraCadMaster } from '../features/pedido-compra/PedidoCompraCadMaster';
import { CondicoesPagtoCadMaster } from '../features/condicoes-pagto/CondicoesPagtoCadMaster';
import { DevolucaoCompraCadMaster } from '../features/devolucao-compra/DevolucaoCompraCadMaster';
import { CotacaoPage } from '../features/cotacao/CotacaoPage';
import { AgendaPromocaoCadMaster } from '../features/agenda-promocao/AgendaPromocaoCadMaster';
import { PromocaoCadMaster } from '../features/promocao/PromocaoCadMaster';
import { PerfilCadMaster } from '../features/perfil/PerfilCadMaster';
import { EmpresasCadMaster } from '../features/empresas/EmpresasCadMaster';
import { AjusteEstoquePage } from '../features/ajuste-estoque/AjusteEstoquePage';
import { InventarioPage } from '../features/inventario/InventarioPage';
import { ScrapPage } from '../features/scrap/ScrapPage';
import { ProducaoPage } from '../features/producao/ProducaoPage';
import { EtiquetaPage } from '../features/etiqueta/EtiquetaPage';
import { ControleContasPage } from '../features/controle-contas/ControleContasPage';
import { ExportaBalancaPage } from '../features/exporta-balanca/ExportaBalancaPage';
import { AjustePrecosPage } from '../features/ajuste-precos/AjustePrecosPage';
import { PrecificacaoCustoPage } from '../features/precificacao-custo/PrecificacaoCustoPage';
import { RelVendasPage } from '../features/rel-vendas/RelVendasPage';
import { PreviaFornecedorPage } from '../features/previa-fornecedor/PreviaFornecedorPage';
import { ConferenciaNotaPage } from '../features/conferencia-nota/ConferenciaNotaPage';
import { RelFinalizadorasPage } from '../features/rel-finalizadoras/RelFinalizadorasPage';
import { RelTicketMedioPage } from '../features/rel-ticket-medio/RelTicketMedioPage';
import { RelCaixaDrePage } from '../features/rel-caixa-dre/RelCaixaDrePage';
import { RelSemMovimentoPage } from '../features/rel-sem-movimento/RelSemMovimentoPage';
import { RelCurvaAbcPage } from '../features/rel-curva-abc/RelCurvaAbcPage';
import { RelVendasDataPage } from '../features/rel-vendas-data/RelVendasDataPage';
import { RelVendasDepartamentoPage } from '../features/rel-vendas-departamento/RelVendasDepartamentoPage';
import { RelVendasHoraPage } from '../features/rel-vendas-hora/RelVendasHoraPage';
import { RelFormasPgtoPage } from '../features/rel-formas-pgto/RelFormasPgtoPage';
import { RelVendasOperadorPage } from '../features/rel-vendas-operador/RelVendasOperadorPage';
import { RelCaixaOpsPage } from '../features/rel-caixa-ops/RelCaixaOpsPage';
import { CartaoPage } from '../features/cartao/CartaoPage';
import { OperadorasPage } from '../features/cartao/OperadorasPage';
import { TrocaPage } from '../features/troca/TrocaPage';
import { ConciliacaoBancariaPage } from '../features/conciliacao/ConciliacaoBancariaPage';
import { MotivosOperacaoCadMaster } from '../features/motivos-operacao/MotivosOperacaoCadMaster';
import { ConfiguracoesPage } from '../features/configuracoes/ConfiguracoesPage';

// Rotas = telas (uma TForm = uma rota), todas no pilar <CadMaster>/<CadMasterDet>,
// dentro da casca AppShell (<Outlet>). Consolidado — sem List/Form standalone.
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> }, // público (fora da guarda/AppLayout)
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <Navigate to="/cadastro/bancos" replace /> },
      { path: '/cadastro/bancos', element: <BancosCadMaster /> },
      { path: '/cadastro/marcas', element: <MarcasCadMaster /> },
      { path: '/cadastro/bairros', element: <BairrosCadMaster /> },
      { path: '/cadastro/cidades', element: <CidadesCadMaster /> },
      { path: '/cadastro/precos', element: <PrecosCadMaster /> },
      { path: '/cadastro/ncm', element: <NcmCadMaster /> },
      { path: '/cadastro/cfop', element: <CfopCadMaster /> },
      { path: '/cadastro/operacoes-conta', element: <OperacoesContaCadMaster /> },
      { path: '/cadastro/contas-bancarias', element: <ContasBancariasCadMaster /> },
      { path: '/cadastro/empresas', element: <EmpresasCadMaster /> },
      { path: '/cadastro/operadores', element: <OperadoresCadMaster /> },
      { path: '/cadastro/formas-pgto', element: <FormasPgtoCadMaster /> },
      // tela UNIFICADA de parceiros — mesmo componente, papel diferente
      { path: '/cadastro/clientes', element: <ParceirosCadMaster papel="cliente" /> },
      { path: '/cadastro/fornecedores', element: <ParceirosCadMaster papel="fornecedor" /> },
      { path: '/cadastro/produtos', element: <ProdutoCadMaster /> },
      { path: '/cobranca/lotes', element: <LotesCobrancaCadMaster /> }, // mestre-detalhe
      { path: '/cadastro/areceber', element: <ContasReceberCadMaster /> }, // contas a receber (cortes 1+2)
      { path: '/cadastro/apagar', element: <ContasPagarCadMaster /> }, // contas a pagar (gêmea)
      { path: '/cobranca/caixa', element: <CaixaPage /> }, // caixa (sessão + movimento manual, corte-1)
      { path: '/estoque/ajuste', element: <AjusteEstoquePage /> }, // ajuste de estoque (move o saldo + kardex)
      { path: '/estoque/inventario', element: <InventarioPage /> }, // inventário (contagem física; sobrescreve o saldo)
      { path: '/estoque/scrap', element: <ScrapPage /> }, // scrap/perdas (documento de perda; baixa do saldo + kardex)
      { path: '/estoque/troca', element: <TrocaPage /> }, // troca c/ fornecedor (avariados saem; baixa do saldo + kardex)
      { path: '/estoque/producao', element: <ProducaoPage /> }, // produção/manufatura (explode receita → baixa ingredientes + entra acabado)
      { path: '/estoque/etiquetas', element: <EtiquetaPage /> }, // etiquetas de preço (fila do coletor + preço/promo MULTI_PRECO + imprimir Code-128)
      { path: '/estoque/balanca', element: <ExportaBalancaPage /> }, // exporta PLUs p/ balança Toledo (TXITENS/CADASTRO/ITENSMGV download)
      { path: '/estoque/ajuste-precos', element: <AjustePrecosPage /> },
      { path: '/estoque/precificacao', element: <PrecificacaoCustoPage /> },
      { path: '/relatorios/vendas', element: <RelVendasPage /> },
      { path: '/relatorios/previa-fornecedor', element: <PreviaFornecedorPage /> },
      { path: '/compras/conferencia-nota', element: <ConferenciaNotaPage /> },
      { path: '/relatorios/finalizadoras', element: <RelFinalizadorasPage /> },
      { path: '/relatorios/ticket-medio', element: <RelTicketMedioPage /> },
      { path: '/relatorios/caixa-dre', element: <RelCaixaDrePage /> },
      { path: '/relatorios/sem-movimento', element: <RelSemMovimentoPage /> },
      { path: '/relatorios/vendas-data', element: <RelVendasDataPage /> }, // rel 02: fechamento diário
      { path: '/relatorios/vendas-departamento', element: <RelVendasDepartamentoPage /> }, // rel 38: dia × departamento
      { path: '/relatorios/vendas-hora', element: <RelVendasHoraPage /> }, // rel 07: perfil por hora × caixas abertos
      { path: '/relatorios/formas-pgto', element: <RelFormasPgtoPage /> }, // rel 08: participação por finalizadora
      { path: '/relatorios/vendas-operador', element: <RelVendasOperadorPage /> }, // rel 06/19/25/36/46: família operador/vendedor
      { path: '/relatorios/caixa-ops', element: <RelCaixaOpsPage /> }, // rel 04/05: sangrias/suprimentos + liberações do PDV
      { path: '/relatorios/curva-abc', element: <RelCurvaAbcPage /> }, // rel 09: classificação A/B/C por faturamento acumulado // rel 13: o que não girou // DRE de caixa por conta gerencial // 4º relatório: cupons × média por dia // 3º relatório: vendas × formas de pagamento // aprovar/cancelar a conferência do coletor // 2º relatório: giro produto × 15 dias // 1º relatório: produtos vendidos no período // precificação de mercadorias (painel custo→PMZ→preço por produto×empresa) // ajuste de preços - lote (processa a fila lote_preco → multi_preco)
      { path: '/financeiro/cartoes', element: <CartaoPage /> }, // recebíveis de cartão (consulta + cadastro; líquido/venc computados)
      { path: '/cadastro/operadoras', element: <OperadorasPage /> }, // administradora/adquirente + taxa por-empresa
      { path: '/financeiro/conciliacao', element: <ConciliacaoBancariaPage /> }, // conciliação bancária OFX × razão interno
      { path: '/financeiro/contas-correntes', element: <ControleContasPage /> }, // controle de contas correntes (lançamento manual + transferência + estorno)
      { path: '/cadastro/motivos-operacao', element: <MotivosOperacaoCadMaster /> }, // lookup do motivo do ajuste
      { path: '/cadastro/plano-contas', element: <PlanoContasCadMaster /> }, // plano de contas (árvore)
      { path: '/contabil/dre', element: <DreRelatorio /> }, // relatório DRE (calculado do diário)
      { path: '/contabil/razao', element: <RazaoRelatorio /> }, // livro razão (movimentos do diário por conta)
      // tela-coroa NF — mesmo componente, tipo diferente (Entrada/Saída), como Parceiros (papel)
      { path: '/fiscal/notas/entrada', element: <NfCadMaster tipo="E" /> },
      { path: '/fiscal/notas/saida', element: <NfCadMaster tipo="S" /> },
      // pedido de compra (mestre-detalhe) — documento de intenção; o FATO nasce na NF de entrada
      { path: '/compras/pedidos', element: <PedidoCompraCadMaster /> },
      { path: '/compras/condicoes-pagto', element: <CondicoesPagtoCadMaster /> }, // lookup do pedido (corte-2)
      { path: '/compras/devolucao', element: <DevolucaoCompraCadMaster /> }, // devolução de compra (documento, corte-1)
      { path: '/compras/cotacao', element: <CotacaoPage /> }, // cotação de compra (RFQ): preços → apuração → gerar pedidos
      { path: '/cadastro/promocoes', element: <AgendaPromocaoCadMaster /> }, // agenda de promoção (corte-1, sem efeito)
      { path: '/cadastro/gestao-promocoes', element: <PromocaoCadMaster /> }, // Gestão de Promoções (UCadPromocao): corte-1 Preço Fixo
      { path: '/cadastro/perfis', element: <PerfilCadMaster /> }, // perfis & permissões (RBAC editor)
      { path: '/cadastro/configuracoes', element: <ConfiguracoesPage /> }, // configurações (UConfigura): chave-valor por empresa
    ],
  },
]);
