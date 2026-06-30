import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from '@apollosg/design-system';
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
} from 'lucide-react';

/** Telas do menu lateral (rota → rótulo + ícone). Uma TForm = um item. */
const TELAS = [
  { href: '/cadastro/clientes', name: 'Clientes', icon: Users },
  { href: '/cadastro/fornecedores', name: 'Fornecedores', icon: Truck },
  { href: '/cadastro/produtos', name: 'Produtos', icon: Package },
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
] as const;

/**
 * Casca da aplicação (AppShell do DS): rail + menu lateral data-driven com todas
 * as telas + header com breadcrumb. O corpo é o <Outlet> da rota atual. Substitui
 * o "sem layout" anterior — dá a identidade de produto do Apollo.
 */
export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const atual = TELAS.find((t) => t.href === location.pathname);

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
      user={{ name: 'Operador', email: 'operador@apollosg.com.br', initials: 'OP' }}
    >
      <Outlet />
    </AppShell>
  );
}
