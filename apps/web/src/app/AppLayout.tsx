import { useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { imprimirPagina } from '../shared/print/imprimirPagina';
import { AppShell } from '@apollosg/design-system';
import { ShortcutScope } from '../shared/keyboard';
import { useAuth } from '../features/auth/AuthContext';
import {
  Landmark,
  Tags,
  MapPin,
  Building2,
  DollarSign,
  FileText,
  Receipt,
  Wallet,
  ListChecks,
  Users,
  Truck,
  Package,
  FileInput,
  FileOutput,
  Building,
  HandCoins,
  Banknote,
  Network,
  BarChart3,
  Coins,
  UserCog,
  ShieldCheck,
  BookText,
  CreditCard,
  ShoppingCart,
  FileSearch,
  ArrowLeftRight,
  CalendarClock,
  UserSearch,
  Undo2,
  ClipboardList,
  Settings,
  BookOpen,
  Percent,
  Trash2,
  ChefHat,
  Tag,
  ArrowRightLeft,
  Scale,
  TrendingUp,
  Calculator,
  LineChart,
} from 'lucide-react';

/** Telas do menu lateral (rota → rótulo + ícone). Uma TForm = um item. */
const TELAS = [
  { href: '/cadastro/clientes', name: 'Clientes', icon: Users },
  { href: '/cadastro/fornecedores', name: 'Fornecedores', icon: Truck },
  { href: '/cadastro/produtos', name: 'Produtos', icon: Package },
  { href: '/cadastro/promocoes', name: 'Agenda de Promoção', icon: Tags },
  { href: '/cadastro/gestao-promocoes', name: 'Gestão de Promoções', icon: Percent },
  { href: '/compras/pedidos', name: 'Pedido de Compra', icon: ShoppingCart },
  { href: '/compras/condicoes-pagto', name: 'Condições de Pagamento', icon: CalendarClock },
  { href: '/compras/devolucao', name: 'Devolução de Compra', icon: Undo2 },
  { href: '/compras/cotacao', name: 'Cotação de Compra', icon: ListChecks },
  { href: '/fiscal/notas/entrada', name: 'NF de Entrada', icon: FileInput },
  { href: '/fiscal/notas/saida', name: 'NF de Saída', icon: FileOutput },
  { href: '/cadastro/bancos', name: 'Bancos', icon: Landmark },
  { href: '/cadastro/marcas', name: 'Marcas', icon: Tags },
  { href: '/cadastro/bairros', name: 'Bairros', icon: MapPin },
  { href: '/cadastro/cidades', name: 'Cidades', icon: Building2 },
  { href: '/cadastro/precos', name: 'Reajuste de Preço', icon: DollarSign },
  { href: '/cadastro/ncm', name: 'NCM', icon: FileText },
  { href: '/cadastro/cfop', name: 'CFOP', icon: FileText },
  { href: '/cadastro/contas-bancarias', name: 'Contas Bancárias', icon: Wallet },
  { href: '/cadastro/operacoes-conta', name: 'Operações de Conta', icon: Receipt },
  { href: '/cobranca/lotes', name: 'Lote de Cobrança', icon: ListChecks },
  { href: '/cobranca/cnab', name: 'Boleto / Remessa CNAB', icon: Landmark },
  { href: '/cadastro/areceber', name: 'Contas a Receber', icon: HandCoins },
  { href: '/cadastro/apagar', name: 'Contas a Pagar', icon: Banknote },
  { href: '/cobranca/caixa', name: 'Caixa', icon: Coins },
  { href: '/financeiro/cartoes', name: 'Cartões / Recebíveis', icon: CreditCard },
  { href: '/financeiro/conciliacao', name: 'Conciliação Bancária', icon: Landmark },
  { href: '/financeiro/contas-correntes', name: 'Controle de Contas Correntes', icon: ArrowRightLeft },
  { href: '/financeiro/adiantamentos', name: 'Adiantamento a Fornecedor', icon: HandCoins },
  { href: '/vendas/historico', name: 'Histórico de Vendas', icon: Receipt },
  { href: '/fiscal/apuracao-icms', name: 'Apuração de ICMS', icon: Receipt },
  { href: '/cadastro/operadoras', name: 'Operadoras de Cartão', icon: CreditCard },
  { href: '/estoque/ajuste', name: 'Ajuste de Estoque', icon: Package },
  { href: '/estoque/inventario', name: 'Inventário', icon: ClipboardList },
  { href: '/estoque/inventario-rotativo', name: 'Inventário rotativo', icon: ClipboardList },
  { href: '/estoque/scrap', name: 'Scrap / Perdas', icon: Trash2 },
  { href: '/estoque/troca', name: 'Troca com Fornecedor', icon: Undo2 },
  { href: '/estoque/producao', name: 'Produção', icon: ChefHat },
  { href: '/estoque/etiquetas', name: 'Etiquetas de Preço', icon: Tag },
  { href: '/estoque/balanca', name: 'Exportar p/ Balança', icon: Scale },
  { href: '/estoque/ajuste-precos', name: 'Ajuste de Preços', icon: TrendingUp },
  { href: '/estoque/precificacao', name: 'Precificação de Mercadorias', icon: Calculator },
  { href: '/compras/conferencia-nota', name: 'Conferência de Nota', icon: LineChart },
  { href: '/compras/manifesto-dfe', name: 'Manifesto DF-e', icon: LineChart },
  { href: '/compras/pendencias', name: 'Pendências do Operador', icon: ListChecks },
  // HUB FRMRELVENDAS — uma tela só com combo de modelo (rel 01/02/06/07/08/09-11/13/18/28/30/32/36/38/46).
  // As variantes seguem deep-linkáveis pelas rotas antigas; aqui o menu aponta só pro hub.
  { href: '/relatorios/vendas', name: 'Relatórios de Vendas', icon: LineChart },
  // FRMRELATORIO — os relatórios que o próprio cliente monta (corte-1: executar).
  { href: '/relatorios/construtor', name: 'Relatórios', icon: ClipboardList },
  { href: '/relatorios/previa-fornecedor', name: 'Prévia do Fornecedor', icon: LineChart },
  { href: '/relatorios/caixa-dre', name: 'Caixa — D.R.E.', icon: LineChart },
  { href: '/relatorios/caixa-ops', name: 'Operações de Caixa', icon: LineChart },
  { href: '/cadastro/motivos-operacao', name: 'Motivos de Operação', icon: ListChecks },
  { href: '/cadastro/plano-contas', name: 'Plano de Contas', icon: Network },
  { href: '/contabil/dre', name: 'DRE', icon: BarChart3 },
  { href: '/contabil/razao', name: 'Livro Razão', icon: BookOpen },
  // FRMRELLANCAMENTOSCONTABEIS — o razão por lançamento, com a origem pelo nome (377 acessos).
  { href: '/contabil/lancamentos', name: 'Lançamentos Contábeis', icon: ClipboardList },
  // FRMTRON — o exportador contábil: grava as partidas do razão por origem (cartões, baixas, documentos).
  { href: '/contabil/integracao', name: 'Integração Contábil', icon: ArrowRightLeft },
  // FRMNFANALISE — a análise fiscal das notas (704 acessos no cliente).
  { href: '/fiscal/nf-analise', name: 'Análise de Notas', icon: Calculator },
  // FRMSALDOEMPRESA — o fluxo de caixa projetado (611 acessos).
  { href: '/cobranca/saldo-empresa', name: 'Saldo da Empresa', icon: TrendingUp },
  // FRMRELCAIXA — divergências de caixa e caixas abertos (505 acessos).
  { href: '/cobranca/rel-caixa', name: 'Relatórios de Caixa', icon: Coins },
  // FRMCONSULTORIAATM — participação e rentabilidade por nível da árvore (440 acessos).
  { href: '/relatorios/consultoria', name: 'Consultoria', icon: BarChart3 },
  // FRMRELCARTOES — total por cartão: bruto, líquido e o que fica com a operadora (382 acessos).
  { href: '/relatorios/cartoes', name: 'Total por Cartão', icon: CreditCard },
  // FRMRENTABILIDADECATEGORIAS — a rentabilidade depois do imposto e da despesa (275 acessos).
  { href: '/relatorios/rentabilidade', name: 'Rentabilidade', icon: Percent },
  // FRMPRECIFICACAONF — onde o preço nasce quando a mercadoria chega (236 acessos).
  { href: '/precificacao/nf', name: 'Precificação de NF', icon: Tag },
  // FRMRELCOMPRAS — os três relatórios de compra por categoria (204 acessos).
  { href: '/relatorios/compras', name: 'Relatórios de compras', icon: ShoppingCart },
  // FRMCADPROMOCAOACUMULATIVA — leve N, pague menos (199 acessos, 26 operadores).
  { href: '/cadastro/promocao-acumulativa', name: 'Promoção acumulativa', icon: Tag },
  // FRMCONFERENCIANFINDEXADOR — sistema × XML da nota, item a item (165 acessos).
  { href: '/fiscal/conferencia-nf-indexador', name: 'Conferência NF × Indexador', icon: FileSearch },
  // FRMPRODUTOSREL — corte-1: estoque atual, ruptura e análise (162 acessos).
  { href: '/relatorios/produtos', name: 'Relatórios de produtos', icon: Package },
  // FRMRELENTRADASSAIDAS — listagem e comparativo entrada × saída (148 acessos).
  { href: '/relatorios/entradas-saidas', name: 'Entradas e saídas', icon: ArrowLeftRight },
  // FRMCADCOTACAOFORN — o fornecedor preenche os preços (137 acessos).
  { href: '/compras/cotacao-forn', name: 'Preencher cotação', icon: ClipboardList },
  // FRMRELDDE — com o que tenho, quantos dias eu aguento (132 acessos).
  { href: '/relatorios/dias-estoque', name: 'Dias de estoque', icon: CalendarClock },
  // FRMRELINTERSECCAOPRODUTOS — o que o cliente leva junto (117 acessos).
  { href: '/relatorios/interseccao-produtos', name: 'Intersecção de produtos', icon: Network },
  // FRMDIGITACAOPEDIDOS — o pedido de VENDA (116 acessos).
  { href: '/compras/pedido-venda', name: 'Digitação de pedidos', icon: ClipboardList },
  // FRMFLUXOCARTOES — o recebível de cartão por dia (98 acessos).
  { href: '/financeiro/fluxo-cartoes', name: 'Fluxo de cartões', icon: CreditCard },
  // FRMRELFATURAMENTO — faturamento por mês, com a perna NFC-e (80 acessos).
  { href: '/relatorios/faturamento', name: 'Faturamento por mês', icon: TrendingUp },
  // FRMRELENTSAI — compra × venda por produto (84 acessos).
  { href: '/relatorios/compra-venda', name: 'Análise compra × venda', icon: Scale },
  // FRMDESCONTOTITULO — encontro de contas RCB × APG (68 acessos, 11 operadores).
  { href: '/financeiro/desconto-titulo', name: 'Desconto de títulos', icon: Scale },
  // FRMCONSCLIRCB — quanto o cliente deve, com juro e atraso (64 acessos).
  { href: '/financeiro/a-receber-cliente', name: 'A receber por cliente', icon: UserSearch },
  // FRMANALISEENTRADAXSAIDA — por fornecedor, saída de venda ou pedido (68 acessos).
  { href: '/relatorios/analise-entrada-saida', name: 'Análise entrada × saída', icon: ArrowLeftRight },
  { href: '/cadastro/fechamento-diario', name: 'Fechamento Diário', icon: CalendarClock },
  // FRMCTRLPERMISSOES — permissão por OPERADOR, que é o modo que o cliente usa (a de Perfis é o outro caminho).
  { href: '/cadastro/permissoes', name: 'Controle de Permissões', icon: ShieldCheck },
  { href: '/cadastro/empresas', name: 'Empresas', icon: Building },
  { href: '/cadastro/operadores', name: 'Operadores', icon: UserCog },
  { href: '/cadastro/perfis', name: 'Perfis & Permissões', icon: ShieldCheck },
  { href: '/cadastro/formas-pgto', name: 'Formas de Pagamento', icon: CreditCard },
  // FRMCADCONFIGCONCILIADOR — o layout com que se lê a planilha de cada operadora (82 acessos, 6 operadores).
  { href: '/cadastro/config-conciliador', name: 'Layouts de conciliação', icon: CreditCard },
  // FRMCADHISTORICOCONTABIL — o texto que o razão imprime, com os `*` que a contabilização preenche.
  { href: '/cadastro/historico-contabil', name: 'Históricos contábeis', icon: BookText },
  // FRMMULTATUALIZACAO — um campo, uma operação, N produtos de uma vez (60 acessos, 6 operadores).
  { href: '/cadastro/mult-atualizacao', name: 'Atualização automática', icon: Package },
  // FRMCONFIGINTEGRACAOCONTABIL — qual situação o razão usa para cada evento (55 acessos).
  { href: '/contabil/config-integracao', name: 'Config. integração contábil', icon: BookText },
  // FRMCONFIGDRECONTABIL — a árvore que define como o DRE é somado (51 acessos).
  { href: '/cadastro/dre-estrutura', name: 'Configurador do DRE', icon: BookText },
  // FRMCADAGENDALIMITACAOVENDA — quanto cada cliente pode levar no dia de promoção forte (51 acessos).
  { href: '/cadastro/agenda-limitacao', name: 'Limitação de venda', icon: Package },
  // FRMCONFINTEGBANCARIA — banco, conta e layout que o CNAB usa na remessa (50 acessos).
  { href: '/cobranca/conf-integ-bancaria', name: 'Integração bancária (boleto)', icon: CreditCard },
  // FRMCADCONFPLANOCONTAS — a máscara do código e as contas padrão por natureza (45 acessos).
  { href: '/cadastro/conf-plano-contas', name: 'Config. plano de contas', icon: BookText },
  // FRMRELFINANCEIRO — recebíveis e compromissos no mesmo extrato (43 acessos, 7 operadores).
  { href: '/relatorios/financeiro', name: 'Relatório financeiro', icon: ArrowLeftRight },
  // FRMSIMULADORVENDA — mexa no preço e veja o lucro que teria dado (42 acessos).
  { href: '/relatorios/simulador-venda', name: 'Simulador de vendas', icon: Tag },
  // FRMAPURACAOPISCOFINS — crédito, débito e o saldo a recolher do bloco M (39 acessos).
  { href: '/fiscal/apuracao-piscofins', name: 'Apuração PIS/COFINS', icon: FileSearch },
  // FRMEXTRATOFORNECEDORES — o que se deve, e quanto se devia numa data passada (38 acessos).
  { href: '/relatorios/extrato-fornecedores', name: 'Extrato de fornecedores', icon: ShoppingCart },
  // FRMANALISECOMPRAVENDACASACARNE — compra a peça, vende o corte (37 acessos, 6 operadores).
  { href: '/relatorios/analise-casa-carne', name: 'Compra × venda (casa de carne)', icon: ArrowLeftRight },
  // FRMRELATORIOVENDASDINAMICO — giro do período + última compra e custo (37 acessos, 8 operadores).
  { href: '/relatorios/vendas-dinamico', name: 'Análise de vendas de produtos', icon: Package },
  // FRMRELPRECOSALTERADOS — que preços mudaram, de quanto para quanto (35 acessos).
  { href: '/relatorios/precos-alterados', name: 'Preços alterados', icon: Tag },
  { href: '/cadastro/configuracoes', name: 'Configurações', icon: Settings },
] as const;

/**
 * Casca da aplicação (AppShell do DS): rail + menu lateral data-driven com todas
 * as telas + header com breadcrumb. O corpo é o <Outlet> da rota atual. Substitui
 * o "sem layout" anterior — dá a identidade de produto do Apollo.
 */
export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { sessao, sair } = useAuth();
  const atual = TELAS.find((t) => t.href === location.pathname);
  const conteudoRef = useRef<HTMLDivElement>(null);

  // IMPRIMIR (substituto do FastReport): fotografa o conteúdo da tela atual — janela aberta SÍNCRONA
  // no clique (popup-blocker) e o clone/print no helper compartilhado.
  const imprimir = () => {
    if (!conteudoRef.current) return;
    const win = window.open('', '_blank', 'width=1024,height=768');
    if (!win) return;
    imprimirPagina(win, conteudoRef.current, atual?.name ?? 'Apollo ERP', sessao?.operador?.nome ?? undefined);
  };

  // usuário REAL da sessão (corte-3b) — substitui o "Operador" decorativo.
  const nome = sessao?.operador?.nome ?? sessao?.operador?.login ?? 'Operador';
  const iniciais = nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'OP';
  const user = { name: nome, email: sessao?.operador?.login ?? '', initials: iniciais };
  const onLogout = () => {
    void sair().finally(() => navigate('/login', { replace: true }));
  };

  return (
    <AppShell
      contexts={[
        {
          id: 'cadastros',
          label: 'Cadastros',
          icon: Landmark,
          items: TELAS.map((t) => ({ name: t.name, href: t.href, icon: t.icon })),
        },
      ]}
      activeItemHref={location.pathname}
      onItemClick={(item) => {
        if (item.href) navigate(item.href);
      }}
      breadcrumb={[{ label: 'Apollo ERP' }, { label: atual?.name ?? 'Cadastro' }]}
      user={user}
      onLogout={onLogout}
    >
      {/* Scope de atalhos BASE (ADR-010): telas customizadas (DRE, Plano de Contas, Caixa) usam
          Button/DateField/etc. via useMnemonic, que exige um <ShortcutScope>. O <CadMaster> provê o
          seu próprio (aninhado); este cobre as telas que não passam pelo shell. */}
      <ShortcutScope>
        {/* botão flutuante de impressão — vale para QUALQUER tela (relatórios, grades, consultas) */}
        <button
          type="button"
          onClick={imprimir}
          title="Imprimir esta tela (Ctrl/Cmd+P do diálogo permite salvar em PDF)"
          className="fixed bottom-4 right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-bg-surface shadow-md hover:bg-bg-subtle print:hidden"
        >
          <Printer className="h-5 w-5" />
        </button>
        <div ref={conteudoRef}>
          <Outlet />
        </div>
      </ShortcutScope>
    </AppShell>
  );
}
