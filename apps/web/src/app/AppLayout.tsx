import { Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  CreditCard,
  ShoppingCart,
  CalendarClock,
  Undo2,
  ClipboardList,
  Settings,
  BookOpen,
  Percent,
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
  { href: '/cadastro/contas-bancarias', name: 'Contas Bancárias', icon: Wallet },
  { href: '/cadastro/operacoes-conta', name: 'Operações de Conta', icon: Receipt },
  { href: '/cobranca/lotes', name: 'Lote de Cobrança', icon: ListChecks },
  { href: '/cadastro/areceber', name: 'Contas a Receber', icon: HandCoins },
  { href: '/cadastro/apagar', name: 'Contas a Pagar', icon: Banknote },
  { href: '/cobranca/caixa', name: 'Caixa', icon: Coins },
  { href: '/estoque/ajuste', name: 'Ajuste de Estoque', icon: Package },
  { href: '/estoque/inventario', name: 'Inventário', icon: ClipboardList },
  { href: '/cadastro/motivos-operacao', name: 'Motivos de Operação', icon: ListChecks },
  { href: '/cadastro/plano-contas', name: 'Plano de Contas', icon: Network },
  { href: '/contabil/dre', name: 'DRE', icon: BarChart3 },
  { href: '/contabil/razao', name: 'Livro Razão', icon: BookOpen },
  { href: '/cadastro/empresas', name: 'Empresas', icon: Building },
  { href: '/cadastro/operadores', name: 'Operadores', icon: UserCog },
  { href: '/cadastro/perfis', name: 'Perfis & Permissões', icon: ShieldCheck },
  { href: '/cadastro/formas-pgto', name: 'Formas de Pagamento', icon: CreditCard },
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
        <Outlet />
      </ShortcutScope>
    </AppShell>
  );
}
