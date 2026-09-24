import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumnDef, type GridSelectionState, PageHeader } from '@apollosg/design-system';
import { NumberField } from '../../shared/ui/NumberField';
import { DateField } from '../../shared/ui/DateField';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { listarCartoes, criarCartao, excluirCartao, listarOperadoras, contasDoOperador, baixarCartoes, estornarLoteCartao, type CartaoRecebivel, type Operadora, type ContaDoOperador, type DestinoBaixaCartao } from './cartaoApi';

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const SEM_SELECAO: GridSelectionState = { type: 'include', ids: new Set() };
const hojeIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

/**
 * CARTÕES / RECEBÍVEIS (FRMCADCARTAO) — corte-1: consulta + cadastro manual. Lista os recebíveis com o LÍQUIDO e o
 * VENCIMENTO computados no servidor (view get_cartao). Filtro aberto/baixado por LIBERADO. A baixa (FRMBAIXACARTAO) marca os
 * recebíveis e leva a data, o destino e o histórico; a geração automática vem do PDV (OFF).
 */
export function CartaoPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<CartaoRecebivel[]>([]);
  const [operadoras, setOperadoras] = useState<Operadora[]>([]);
  const [contas, setContas] = useState<ContaDoOperador[]>([]);
  const [contaBaixa, setContaBaixa] = useState('');
  const [dataBaixa, setDataBaixa] = useState(hojeIso()); // edtDataBaixa — a data que vai a DTBAIXA, MCB e CAIXA
  const [destino, setDestino] = useState<DestinoBaixaCartao>('BANCARIA'); // rdgDestino
  const [historico, setHistorico] = useState(''); // dbmObs — vazio = "REF. BX LOTE: N"
  const [selecao, setSelecao] = useState<GridSelectionState>(SEM_SELECAO);
  const [outrasDesp, setOutrasDesp] = useState<number | undefined>(undefined); // edtOutrasDesp (UbaixaCartao.pas:1151)
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
    void contasDoOperador().then(setContas).catch(() => setContas([]));
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

  const baixarSelecionados = async () => {
    if (busy) return;
    if (!contaBaixa) { window.alert('É necessário informar a conta corrente!'); return; }
    if (!dataBaixa) { window.alert('Informe a data da baixa.'); return; }
    const marcado = (id: number) => (selecao.type === 'include' ? selecao.ids.has(id) : !selecao.ids.has(id));
    const ids = linhas.filter((r) => String(r.liberado ?? 'N') !== 'S' && marcado(Number(r.codvendcartao))).map((r) => Number(r.codvendcartao));
    if (!ids.length) { window.alert('Marque os recebíveis abertos a baixar.'); return; }
    if (!window.confirm(`Baixar ${ids.length} recebível(is) em ${dia(dataBaixa)}? O líquido entra na conta de destino e sai da conta da forma de pagamento.`)) return;
    setBusy(true);
    try {
      const r = await baixarCartoes({ codconta: Number(contaBaixa), codvendcartaos: ids, dataBaixa, destino, historico: historico.trim() || undefined, outrasDespesas: outrasDesp });
      setOutrasDesp(undefined); setHistorico(''); setSelecao(SEM_SELECAO);
      mensagem.sucesso(`Documentos baixados com sucesso — lote ${r.idlote}, ${r.itens} recebível(is); líquido ${brl(r.total_liquido)} creditado (taxa ${brl(r.total_taxa)}${r.outras_despesas ? `, outras despesas ${brl(r.outras_despesas)}` : ''})${r.contabilizado ? '; integrado na contabilidade' : ''}.`);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  const estornarLote = async (idlote: number) => {
    if (!window.confirm(`Tem certeza que deseja reverter todos os documentos do lote ${idlote}?`)) return;
    try { const r = await estornarLoteCartao(idlote); mensagem.sucesso(`Reversão realizada com sucesso — ${r.itens} recebível(is) reaberto(s), ${r.contraMovimentos} movimentação(ões) contrária(s).`); await carregar(); } catch (e) { mensagem.erro(e); }
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
    { field: 'acoes', headerName: '', type: 'actions', width: 130, getActions: ({ row }: { row: CartaoRecebivel }) => (row.liberado === 'S' ? (row.idlote ? [{ id: 'est', label: `Reverter lote ${row.idlote}`, onClick: (r: CartaoRecebivel) => void estornarLote(Number(r.idlote)) }] : []) : [{ id: 'del', label: 'Excluir', onClick: (r: CartaoRecebivel) => void excluir(Number(r.codvendcartao)) }]) },
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
        <small className="w-full text-fg-muted">Líquido = bruto − taxa da administradora; vencimento = data da venda + dias de compensação (calculados no servidor). A geração automática vem do PDV.</small>
      </div>

      <div className="flex flex-wrap items-end gap-gp-sm">
        <div className="w-44"><SelectField label="&Situação" value={filtro} onChange={(v) => setFiltro(v as 'N' | 'S' | '')} options={[{ value: 'N', label: 'Abertos' }, { value: 'S', label: 'Baixados' }, { value: '', label: 'Todos' }]} /></div>
        {filtro === 'N' && (
          <>
            <div className="w-56"><SelectField label="&Destino" value={destino} onChange={(v) => setDestino(v as DestinoBaixaCartao)} options={[{ value: 'BANCARIA', label: 'Conta bancária' }, { value: 'ANTECIPACAO', label: 'Antecipação (conta bancária)' }, { value: 'TESOURARIA', label: 'Tesouraria' }]} /></div>
            <div className="w-64"><SelectField label="&Conta corrente" value={contaBaixa} onChange={setContaBaixa} options={contas.filter((c) => destino === 'TESOURARIA' || !c.caixa).map((c) => ({ value: String(c.codconta), label: `${c.codconta} · ${c.nroconta ?? ''} ${c.titular ?? ''}`.trim() }))} placeholder="(conta de destino)" /></div>
            <div className="w-40"><DateField label="Data da ba&ixa" value={dataBaixa} onChange={(v) => setDataBaixa(v ?? '')} /></div>
            <div className="w-40"><NumberField label="Ou&tras despesas" value={outrasDesp} onChange={setOutrasDesp} decimais={2} min={0} /></div>
            <div className="w-64"><Field label="&Histórico" value={historico} onChange={(e) => setHistorico(e.target.value)} placeholder="REF. BX LOTE: (nº do lote)" /></div>
            <Button label="&Baixar marcados" variant="soft" disabled={busy || !linhas.length} onClick={() => void baixarSelecionados()} />
          </>
        )}
        <div className="flex-1 text-right text-body-sm text-fg-muted">Bruto <b className="text-fg">{brl(totalBruto)}</b> · Líquido <b className="text-fg">{brl(totalLiq)}</b> · {linhas.length} recebível(is)</div>
      </div>
      <DataTable columns={colunas} rows={linhas} loading={carregando} getRowId={(r) => Number(r.codvendcartao)} selectionConfig={{ enabled: filtro === 'N' }} selectionModel={selecao} onSelectionModelChange={setSelecao} />
    </div>
  );
}
