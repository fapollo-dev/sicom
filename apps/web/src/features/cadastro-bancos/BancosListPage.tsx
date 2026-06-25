import { useNavigate } from 'react-router-dom';
import { Button } from '../../shared/ui/Button';
import { ShortcutScope } from '../../shared/keyboard';
import { useBancos, useExcluirBanco } from './hooks';

/** Lista de Bancos (placeholder do DataTable do DS). Enter/clique abre o registro. */
export function BancosListPage() {
  const navigate = useNavigate();
  const { data: bancos = [], isLoading } = useBancos();
  const excluir = useExcluirBanco();

  return (
    <ShortcutScope>
      <div style={{ padding: 24 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>Cadastro de Bancos</h1>
          <Button label="&Novo" onClick={() => navigate('/cadastro/bancos/novo')} />
        </header>
        {isLoading ? (
          <p>Carregando…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #ccc' }}>
                <th>Código</th>
                <th>Banco</th>
                <th>Agência</th>
                <th>Cidade</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bancos.map((b) => (
                <tr
                  key={b.codbco}
                  tabIndex={0}
                  onClick={() => navigate(`/cadastro/bancos/${b.codbco}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/cadastro/bancos/${b.codbco}`)}
                  style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                >
                  <td>{b.codbco}</td>
                  <td>{b.banco}</td>
                  <td>{b.agencia}</td>
                  <td>{b.cidade}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Button
                      label="E&xcluir"
                      variant="ghost"
                      onClick={() => excluir.mutate(b.codbco!)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ShortcutScope>
  );
}
