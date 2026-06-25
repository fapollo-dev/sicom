import { useNavigate } from 'react-router-dom';
import { Button } from '../../shared/ui/Button';
import { ShortcutScope } from '../../shared/keyboard';
import { useContasBancarias, useExcluirContaBancaria } from './hooks';

export function ContasBancariasListPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = useContasBancarias();
  const excluir = useExcluirContaBancaria();

  return (
    <ShortcutScope>
      <div style={{ padding: 24 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>Contas Bancárias</h1>
          <Button label="&Novo" onClick={() => navigate('/cadastro/contas-bancarias/novo')} />
        </header>
        {isLoading ? (
          <p>Carregando…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #ccc' }}>
                <th>Código</th>
                <th>Banco</th>
                <th>Titular</th>
                <th>Nº Conta</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.codconta}
                  tabIndex={0}
                  onClick={() => navigate(`/cadastro/contas-bancarias/${c.codconta}`)}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && navigate(`/cadastro/contas-bancarias/${c.codconta}`)
                  }
                  style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                >
                  <td>{c.codconta}</td>
                  <td>{c.banco /* nome via lookup/JOIN */}</td>
                  <td>{c.titular}</td>
                  <td>{c.nroconta}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Button label="E&xcluir" variant="ghost" onClick={() => excluir.mutate(c.codconta)} />
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
