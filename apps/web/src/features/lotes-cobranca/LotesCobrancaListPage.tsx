import { useNavigate } from 'react-router-dom';
import { Button } from '../../shared/ui/Button';
import { ShortcutScope } from '../../shared/keyboard';
import { useLotes, useExcluirLote } from './hooks';

export function LotesCobrancaListPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = useLotes();
  const excluir = useExcluirLote();

  return (
    <ShortcutScope>
      <div style={{ padding: 24 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>Lotes de Cobrança</h1>
          <Button label="&Novo" onClick={() => navigate('/cobranca/lotes/novo')} />
        </header>
        {isLoading ? (
          <p>Carregando…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #ccc' }}>
                <th>Lote</th>
                <th>Parceiro</th>
                <th>Data</th>
                <th>Itens</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr
                  key={l.codlotecob}
                  tabIndex={0}
                  onClick={() => navigate(`/cobranca/lotes/${l.codlotecob}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/cobranca/lotes/${l.codlotecob}`)}
                  style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                >
                  <td>{l.codlotecob}</td>
                  <td>{l.codparceiro}</td>
                  <td>{String(l.data).slice(0, 10)}</td>
                  <td>{l.qtd_itens}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Button label="E&xcluir" variant="ghost" onClick={() => excluir.mutate(l.codlotecob)} />
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
