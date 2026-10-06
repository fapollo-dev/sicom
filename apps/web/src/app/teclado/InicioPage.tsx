import { PageHeader } from '@apollosg/design-system';
import { getSessao } from '../../shared/auth/session';

/**
 * O menu principal sem tela aberta (o `frmMenuSuperior` do legado): para onde o Esc leva ao fechar uma tela.
 */
export function InicioPage() {
  const s = getSessao();
  const emp = s?.empresas?.find((e) => Number(e.idempresa) === Number(s?.empresa));
  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Apollo ERP" description={`Empresa: ${s?.empresa ?? ''}${emp?.nome ? ` - ${emp.nome}` : ''}`} />
      <p className="text-body-sm text-fg-muted">Escolha uma tela no menu. Ctrl+E troca de empresa.</p>
    </div>
  );
}
