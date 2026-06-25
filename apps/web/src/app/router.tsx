import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { BancosListPage } from '../features/cadastro-bancos/BancosListPage';
import { BancoFormPage } from '../features/cadastro-bancos/BancoFormPage';
import { OperacoesContaListPage } from '../features/operacoes-conta/OperacoesContaListPage';
import { OperacoesContaFormPage } from '../features/operacoes-conta/OperacoesContaFormPage';
import { ContasBancariasListPage } from '../features/contas-bancarias/ContasBancariasListPage';
import { ContasBancariasFormPage } from '../features/contas-bancarias/ContasBancariasFormPage';
import { LotesCobrancaListPage } from '../features/lotes-cobranca/LotesCobrancaListPage';
import { LotesCobrancaFormPage } from '../features/lotes-cobranca/LotesCobrancaFormPage';
import { MarcasCadMaster } from '../features/marcas/MarcasCadMaster';
import { BairrosCadMaster } from '../features/bairros/BairrosCadMaster';
import { PrecosCadMaster } from '../features/precos/PrecosCadMaster';
import { NcmCadMaster } from '../features/ncm/NcmCadMaster';
import { CidadesCadMaster } from '../features/cidades/CidadesCadMaster';
import { LotesCobrancaCadMaster } from '../features/lotes-md/LotesCobrancaCadMaster';

// Rotas = telas (uma TForm = uma rota), todas dentro da casca AppShell (<Outlet>).
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <Navigate to="/cadastro/bancos" replace /> },
      { path: '/cadastro/bancos', element: <BancosListPage /> },
      { path: '/cadastro/bancos/:codbco', element: <BancoFormPage /> },
      { path: '/cadastro/operacoes-conta', element: <OperacoesContaListPage /> },
      { path: '/cadastro/operacoes-conta/:cod', element: <OperacoesContaFormPage /> },
      { path: '/cadastro/contas-bancarias', element: <ContasBancariasListPage /> },
      { path: '/cadastro/contas-bancarias/:cod', element: <ContasBancariasFormPage /> },
      { path: '/cobranca/lotes', element: <LotesCobrancaListPage /> },
      { path: '/cobranca/lotes/:cod', element: <LotesCobrancaFormPage /> },
      { path: '/cadastro/marcas', element: <MarcasCadMaster /> }, // shell CadMaster (pilar)
      { path: '/cadastro/bairros', element: <BairrosCadMaster /> }, // texto+combo+flag+lookup
      { path: '/cadastro/precos', element: <PrecosCadMaster /> }, // número/moeda + checkbox
      { path: '/cadastro/ncm', element: <NcmCadMaster /> }, // chave natural + data + memo
      { path: '/cadastro/cidades', element: <CidadesCadMaster /> }, // alvo do lookup de Bairros
      { path: '/cobranca/lotes-md', element: <LotesCobrancaCadMaster /> }, // mestre-detalhe
    ],
  },
]);
