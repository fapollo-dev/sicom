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
import { OperacoesContaCadMaster } from '../features/operacoes-conta/OperacoesContaCadMaster';
import { ContasBancariasCadMaster } from '../features/contas-bancarias/ContasBancariasCadMaster';
import { LotesCobrancaCadMaster } from '../features/lotes-md/LotesCobrancaCadMaster';
import { ContasReceberCadMaster } from '../features/areceber/ContasReceberCadMaster';
import { ContasPagarCadMaster } from '../features/apagar/ContasPagarCadMaster';
import { PlanoContasCadMaster } from '../features/plano-contas/PlanoContasCadMaster';
import { DreRelatorio } from '../features/dre/DreRelatorio';
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
import { PerfilCadMaster } from '../features/perfil/PerfilCadMaster';
import { EmpresasCadMaster } from '../features/empresas/EmpresasCadMaster';
import { AjusteEstoquePage } from '../features/ajuste-estoque/AjusteEstoquePage';
import { InventarioPage } from '../features/inventario/InventarioPage';
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
      { path: '/cadastro/motivos-operacao', element: <MotivosOperacaoCadMaster /> }, // lookup do motivo do ajuste
      { path: '/cadastro/plano-contas', element: <PlanoContasCadMaster /> }, // plano de contas (árvore)
      { path: '/contabil/dre', element: <DreRelatorio /> }, // relatório DRE (calculado do diário)
      // tela-coroa NF — mesmo componente, tipo diferente (Entrada/Saída), como Parceiros (papel)
      { path: '/fiscal/notas/entrada', element: <NfCadMaster tipo="E" /> },
      { path: '/fiscal/notas/saida', element: <NfCadMaster tipo="S" /> },
      // pedido de compra (mestre-detalhe) — documento de intenção; o FATO nasce na NF de entrada
      { path: '/compras/pedidos', element: <PedidoCompraCadMaster /> },
      { path: '/compras/condicoes-pagto', element: <CondicoesPagtoCadMaster /> }, // lookup do pedido (corte-2)
      { path: '/compras/devolucao', element: <DevolucaoCompraCadMaster /> }, // devolução de compra (documento, corte-1)
      { path: '/compras/cotacao', element: <CotacaoPage /> }, // cotação de compra (RFQ): preços → apuração → gerar pedidos
      { path: '/cadastro/promocoes', element: <AgendaPromocaoCadMaster /> }, // agenda de promoção (corte-1, sem efeito)
      { path: '/cadastro/perfis', element: <PerfilCadMaster /> }, // perfis & permissões (RBAC editor)
      { path: '/cadastro/configuracoes', element: <ConfiguracoesPage /> }, // configurações (UConfigura): chave-valor por empresa
    ],
  },
]);
