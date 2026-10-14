import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../shared/ui/Button';
import { DateField } from '../../shared/ui/DateField';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { useMensagem } from '../../shared/mensagem';
import { hojeNaLoja } from '../../shared/tempo';
import { historicoVendasParceiro, type LinhaHistoricoVendas } from './parceirosApi';

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtData = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s;
};

/**
 * A aba HISTÓRICO DE VENDAS do uCadClientes (`tbsHistoricoVendas`: edtData1/edtData2, RGorigemHistoricoVendas Vendas/Pedidos, Buscar,
 * a grade e o duplo clique que abre a venda — `DBGHistoricoVendasDblClick` → frmConsHistVendas). As lojas são as do `GetMultiEmpresa`
 * (vazio = a do login). Só para o parceiro gravado.
 */
export function HistoricoVendasSection({ codparceiro }: { codparceiro?: number }) {
  const mensagem = useMensagem();
  const navigate = useNavigate();
  const hoje = hojeNaLoja();
  const [de, setDe] = useState(`${hoje.slice(0, 8)}01`);
  const [ate, setAte] = useState(hoje);
  const [origem, setOrigem] = useState<'V' | 'P'>('V');
  const [empresas, setEmpresas] = useState('');
  const [dados, setDados] = useState<{ linhas: LinhaHistoricoVendas[]; total: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (codparceiro == null) return <span className="text-body-sm text-fg-muted">Grave o parceiro para consultar o histórico de vendas.</span>;
  const buscar = async () => {
    if (!de || !ate) { mensagem.erro(new Error('Informe o período da pesquisa.')); return; }
    setOcupado(true);
    try { setDados(await historicoVendasParceiro(codparceiro, { de, ate, origem, empresas: empresas.trim() || undefined })); }
    catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  // o duplo clique do legado abre a venda na consulta de histórico (o pedido do PDV na loja da linha; o pedido de balcão no modo pedido)
  const abrir = (l: LinhaHistoricoVendas) => {
    if (!l.nropedido) return;
    navigate(origem === 'P' ? `/vendas/historico?balcao=1&nropedido=${encodeURIComponent(l.nropedido)}` : `/vendas/historico?nropedido=${encodeURIComponent(l.nropedido)}&empresa=${l.idempresa ?? ''}`);
  };
  return (
    <div className="flex flex-col gap-form-gap">
      <div className="grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-6">
        <DateField label="De" value={de || undefined} onChange={(v) => setDe(v ?? '')} />
        <DateField label="Até" value={ate || undefined} onChange={(v) => setAte(v ?? '')} />
        <SelectField label="Informe a origem" options={[{ value: 'V', label: 'Vendas' }, { value: 'P', label: 'Pedidos' }]} value={origem} onChange={(v) => setOrigem(v === 'P' ? 'P' : 'V')} />
        <Field label="Empresas (1,2)" value={empresas} onChange={(e) => setEmpresas(e.target.value)} placeholder="esta loja" />
        <div className="self-end"><Button label="&Buscar" variant="soft" onClick={buscar} disabled={ocupado} /></div>
        {dados && <div className="self-end text-body-sm text-fg-muted">Total: <b className="tabular-nums text-fg-default">R$ {fmtBRL(dados.total)}</b></div>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead><tr className="border-b border-border text-left text-fg-muted">
            <th className="py-1 pr-2">Data</th><th className="py-1 pr-2">Pedido</th>{origem === 'V' && <th className="py-1 pr-2">Cupom</th>}<th className="py-1 pr-2">Parceiro</th><th className="py-1 pr-2">Loja</th><th className="py-1 pr-2 text-right">Total</th>
          </tr></thead>
          <tbody>
            {(dados?.linhas ?? []).map((l, i) => (
              <tr key={`${l.nropedido}-${l.idempresa}-${i}`} className="cursor-pointer border-b border-border hover:bg-bg-subtle" onDoubleClick={() => abrir(l)}>
                <td className="py-1 pr-2">{fmtData(l.dtvenda)}</td><td className="py-1 pr-2">{l.nropedido ?? ''}</td>{origem === 'V' && <td className="py-1 pr-2">{l.nrocupom ?? ''}</td>}
                <td className="py-1 pr-2">{l.razao ?? ''}</td><td className="py-1 pr-2">{l.idempresa ?? ''}</td><td className="py-1 pr-2 text-right tabular-nums">{fmtBRL(Number(l.total))}</td>
              </tr>
            ))}
            {dados && !dados.linhas.length && <tr><td className="py-1 pr-2 text-fg-muted" colSpan={6}>Nenhuma venda no período.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
