import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from './AppLayout';
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
import { ParceirosCadMaster } from '../features/parceiros/ParceirosCadMaster';
import { ProdutoCadMaster } from '../features/produtos/ProdutoCadMaster';
import { NfCadMaster } from '../features/nf/NfCadMaster';
import { EmpresasCadMaster } from '../features/empresas/EmpresasCadMaster';

// Rotas = telas (uma TForm = uma rota), todas no pilar <CadMaster>/<CadMasterDet>,
// dentro da casca AppShell (<Outlet>). Consolidado — sem List/Form standalone.
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
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
      // tela UNIFICADA de parceiros — mesmo componente, papel diferente
      { path: '/cadastro/clientes', element: <ParceirosCadMaster papel="cliente" /> },
      { path: '/cadastro/fornecedores', element: <ParceirosCadMaster papel="fornecedor" /> },
      { path: '/cadastro/produtos', element: <ProdutoCadMaster /> },
      { path: '/cobranca/lotes', element: <LotesCobrancaCadMaster /> }, // mestre-detalhe
      { path: '/cadastro/areceber', element: <ContasReceberCadMaster /> }, // contas a receber (corte-1)
      // tela-coroa NF — mesmo componente, tipo diferente (Entrada/Saída), como Parceiros (papel)
      { path: '/fiscal/notas/entrada', element: <NfCadMaster tipo="E" /> },
      { path: '/fiscal/notas/saida', element: <NfCadMaster tipo="S" /> },
    ],
  },
]);
