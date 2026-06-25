import { useNavigate } from 'react-router-dom';
import { Button } from '../../shared/ui/Button';
import { ShortcutScope } from '../../shared/keyboard';
import { useOperacoesConta, useExcluirOperacaoConta } from './hooks';

export function OperacoesContaListPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = useOperacoesConta();
  const excluir = useExcluirOperacaoConta();

  return (
    <ShortcutScope>
      <div style={{ padding: 24 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>Operações de Conta</h1>
          <Button label="&Novo" onClick={() => navigate('/cadastro/operacoes-conta/novo')} />
        </header>
        {isLoading ? (
          <p>Carregando…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #ccc' }}>
                <th>Código</th>
                <th>Descrição</th>
                <th>Tipo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr
                  key={o.codopconta}
                  tabIndex={0}
                  onClick={() => navigate(`/cadastro/operacoes-conta/${o.codopconta}`)}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && navigate(`/cadastro/operacoes-conta/${o.codopconta}`)
                  }
                  style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                >
                  <td>{o.codopconta}</td>
                  <td>{o.descricao}</td>
                  <td>{o.tipo /* já decodificado pela view: CREDITO/DEBITO */}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Button
                      label="E&xcluir"
                      variant="ghost"
                      onClick={() => excluir.mutate(o.codopconta)}
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
