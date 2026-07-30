import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { NumberField } from '../../shared/ui/NumberField';
import { DateField } from '../../shared/ui/DateField';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { listarCartoes, criarCartao, excluirCartao, listarOperadoras, type CartaoRecebivel, type Operadora } from './cartaoApi';

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

/**
 * CARTÕES / RECEBÍVEIS (FRMCADCARTAO) — corte-1: consulta + cadastro manual. Lista os recebíveis com o LÍQUIDO e o
 * VENCIMENTO computados no servidor (view get_cartao). Filtro aberto/baixado por LIBERADO. A baixa (liquidação) é
 * o corte-2; a geração automática vem do PDV (OFF).
 */
export function CartaoPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<CartaoRecebivel[]>([]);
  const [operadoras, setOperadoras] = useState<Operadora[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<'N' | 'S' | ''>('N'); // aberto / baixado / todos
  const [valor, setValor] = useState<number | undefined>();
  const [oper, setOper] = useState('');
  const [dtvenda, setDtvenda] = useState('');
  const [cupom, setCupom] = useState('');
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setLista(await listarCartoes());
    } catch (e) { mensagem.erro(e); } finally { setCarregando(false); }
  }, [mensagem]);
  useEffect(() => {
    void carregar();
    void listarOperadoras().then(setOperadoras).catch(() => setOperadoras([]));
  }, [carregar]);

  const criar = async () => {
    if (busy) return;
    if (valor == null || valor <= 0) { window.alert('Informe o valor (bruto) maior que zero.'); return; }
    if (!oper) { window.alert('Selecione a operadora.'); return; }
    setBusy(true);
    try {
      await criarCartao({ valor, codoperadora: Number(oper), dtvenda: dtvenda || undefined, nrocupom: cupom || undefined });
      mensagem.sucesso('Recebível lançado.');
      setValor(undefined); setOper(''); setDtvenda(''); setCupom('');
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const excluir = async (id: number) => {
    if (!window.confirm(`Excluir o recebível nº ${id}?`)) return;
    try { await excluirCartao(id); mensagem.sucesso('Recebível excluído.'); await carregar(); } catch (e) { mensagem.erro(e); }
  };

  const linhas = lista.filter((r) => (filtro ? String(r.liberado ?? 'N') === filtro : true));
  const totalBruto = linhas.reduce((s, r) => s + Number(r.valor ?? 0), 0);
  const totalLiq = linhas.reduce((s, r) => s + Number(r.valor_com_taxa ?? 0), 0);

  const colunas: DataTableColumnDef<CartaoRecebivel>[] = [
    { field: 'codvendcartao', headerName: 'Nº', type: 'text', width: 80, isPrimary: true },
    { field: 'dtvenda', headerName: 'Venda', type: 'text', width: 110, valueFormatter: dia },
    { field: 'operadora', headerName: 'Operadora', type: 'text' },
    { field: 'valor', headerName: 'Bruto', type: 'number', width: 120, valueFormatter: brl },
    { field: 'valor_com_taxa', headerName: 'Líquido', type: 'number', width: 120, valueFormatter: brl },
    { field: 'previsao_compensacao', headerName: 'Vencimento', type: 'text', width: 120, valueFormatter: dia },
    { field: 'liberado', headerName: 'Situação', type: 'text', width: 110, valueFormatter: (v: unknown) => (v === 'S' ? 'Baixado' : 'Aberto') },
    { field: 'acoes', headerName: '', type: 'actions', width: 110, getActions: ({ row }: { row: CartaoRecebivel }) => (row.liberado === 'S' ? [] : [{ id: 'del', label: 'Excluir', onClick: (r: CartaoRecebivel) => void excluir(Number(r.codvendcartao)) }]) },
  ];

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Cartões / Recebíveis" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-32"><NumberField label="&Valor bruto" value={valor} decimais={2} min={0} onChange={setValor} /></div>
        <div className="w-56"><SelectField label="&Operadora" value={oper} onChange={setOper} options={operadoras.map((o) => ({ value: String(o.codoperadoras), label: o.operadora }))} placeholder="(operadora)" /></div>
        <div className="w-40"><DateField label="&Data da venda" value={dtvenda} onChange={(v) => setDtvenda(v ?? '')} /></div>
        <div className="w-32"><Field label="&Cupom" value={cupom} onChange={(e) => setCupom(e.target.value)} placeholder="nº cupom" /></div>
        <Button label="&Lançar recebível" variant="soft" disabled={busy} onClick={() => void criar()} />
        <small className="w-full text-fg-muted">Líquido = bruto − taxa da administradora; vencimento = data da venda + dias de compensação (calculados no servidor). A baixa/liquidação e a geração automática pelo PDV virão em cortes seguintes.</small>
      </div>

      <div className="flex flex-wrap items-end gap-gp-sm">
        <div className="w-44"><SelectField label="&Situação" value={filtro} onChange={(v) => setFiltro(v as 'N' | 'S' | '')} options={[{ value: 'N', label: 'Abertos' }, { value: 'S', label: 'Baixados' }, { value: '', label: 'Todos' }]} /></div>
        <div className="flex-1 text-right text-body-sm text-fg-muted">Bruto <b className="text-fg">{brl(totalBruto)}</b> · Líquido <b className="text-fg">{brl(totalLiq)}</b> · {linhas.length} recebível(is)</div>
      </div>
      <DataTable columns={colunas} rows={linhas} loading={carregando} />
    </div>
  );
}
