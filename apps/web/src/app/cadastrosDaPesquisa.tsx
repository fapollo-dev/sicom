import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { registrarCadastroDaPesquisa } from '../shared/cadmaster/CadMasterEmbutido';

/**
 * Os cadastros que o Ins / F2 da Pesquisa abre por cima dela (o par VIEW → FORM da `TABELA_CADASTRO` do legado, aqui um mapa estático
 * por recurso de lookup). Ficam de fora: o que não tem tela de cadastro no menu do legado (cidades, plano de contas — sem FORM para o
 * `PossuiAcessoForm`) e as pesquisas que só a própria tela de produto abre (a GET_PRODUTOS_ESTOQUE: o legado não abre o cadastro que
 * já é a tela que chamou a Pesquisa).
 */
function preguicoso<P extends object>(carregar: () => Promise<ComponentType<P>>): LazyExoticComponent<ComponentType<P>> {
  return lazy(async () => ({ default: await carregar() }));
}
const Parceiros = preguicoso(async () => (await import('../features/parceiros/ParceirosCadMaster')).ParceirosCadMaster);
const Produtos = preguicoso(async () => (await import('../features/produtos/ProdutoCadMaster')).ProdutoCadMaster);
const Familias = preguicoso(async () => (await import('../features/familias/FamiliasCadMaster')).FamiliasCadMaster);
const Plc = preguicoso(async () => (await import('../features/plc/PlcCadMaster')).PlcCadMaster);
const Cfop = preguicoso(async () => (await import('../features/cfop/CfopCadMaster')).CfopCadMaster);
const Operadores = preguicoso(async () => (await import('../features/operadores/OperadoresCadMaster')).OperadoresCadMaster);
const Bancos = preguicoso(async () => (await import('../features/cadastro-bancos/BancosCadMaster')).BancosCadMaster);

const carregando = <p className="p-pad-md text-body-sm text-fg-muted">Abrindo o cadastro…</p>;

registrarCadastroDaPesquisa(['lookup/parceiros'], {
  form: 'FRMCADCLIENTES', titulo: 'Parceiros', pk: 'codparceiro',
  // o papel pelo filtro do campo: FRN = 'S' abre o de fornecedores; o resto, o de clientes
  render: ({ fixos }) => <Suspense fallback={carregando}><Parceiros papel={fixos && 'frn' in fixos ? 'fornecedor' : 'cliente'} /></Suspense>,
});
registrarCadastroDaPesquisa(['lookup/produtos', 'lookup/produtos-pc'], {
  form: 'FRMCADPRODUTO', titulo: 'Produtos', pk: 'idproduto', render: () => <Suspense fallback={carregando}><Produtos /></Suspense>,
});
registrarCadastroDaPesquisa(['lookup/familias'], {
  form: 'FRMCADFAMILIAPROD', titulo: 'Família de produtos', pk: 'codfamilia', render: () => <Suspense fallback={carregando}><Familias /></Suspense>,
});
registrarCadastroDaPesquisa(['lookup/plc'], {
  form: 'FRMCADPLC', titulo: 'Centro de custo', pk: 'codplc', render: () => <Suspense fallback={carregando}><Plc /></Suspense>,
});
registrarCadastroDaPesquisa(['lookup/cfops'], {
  form: 'FRMCADCFOP', titulo: 'CFOP', pk: 'codcfop', render: () => <Suspense fallback={carregando}><Cfop /></Suspense>,
});
registrarCadastroDaPesquisa(['lookup/operadores', 'lookup/operadores-da-loja'], {
  form: 'FRMCADUSUARIOS', titulo: 'Operadores', pk: 'codoperador', render: () => <Suspense fallback={carregando}><Operadores /></Suspense>,
});
registrarCadastroDaPesquisa(['lookup/bancos'], {
  form: 'FRMCADBANCOS', titulo: 'Bancos', pk: 'codbco', render: () => <Suspense fallback={carregando}><Bancos /></Suspense>,
});
