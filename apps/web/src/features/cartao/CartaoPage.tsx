import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { NumberField } from '../../shared/ui/NumberField';
import { DateField } from '../../shared/ui/DateField';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import {
  listarCartoes, criarCartao, excluirCartao, listarOperadoras, contasDoOperador, baixarCartoes, recebivelDaPesquisa, TETO_CONSULTA_CARTOES,
  type CartaoRecebivel, type Operadora, type ContaDoOperador, type DestinoBaixaCartao,
} from './cartaoApi';

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hojeIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

/**
 * CARTÕES / RECEBÍVEIS (FRMCADCARTAO) — corte-1: consulta + cadastro manual, com o LÍQUIDO e o VENCIMENTO computados no servidor.
 * A BAIXA (FRMBAIXACARTAO) é a do legado: "Iniciar Baix&a" / "&Adicionar" abre a Pesquisa da GET_CARTAO — os ABERTOS das lojas, só os
 * CONSILIADO com o fechamento de caixa, por DATA — em multisseleção, e os marcados entram nos DOCUMENTOS DO LOTE sem repetir o código
 * (btnAdicionarRegistroClick + setDocumentos, UbaixaCartao.pas:801-830, :2064-2093); o lote todo é baixado com a data, o destino e o
 * histórico. "Baixados"/"Todos" consultam os mais recentes no servidor. A geração automática vem do PDV (OFF).
 */
export function CartaoPage() {
  const mensagem = useMensagem();
  const navigate = useNavigate();
  const { tem: pode } = useOpcoesDoForm('FRMBAIXACARTAO'); // o btnConsulta tem Tag 1
  const [lista, setLista] = useState<CartaoRecebivel[]>([]);
  const [operadoras, setOperadoras] = useState<Operadora[]>([]);
  const [contas, setContas] = useState<ContaDoOperador[]>([]);
  const [contaBaixa, setContaBaixa] = useState('');
  const [dataBaixa, setDataBaixa] = useState(hojeIso()); // edtDataBaixa — a data que vai a DTBAIXA, MCB e CAIXA
  const [destino, setDestino] = useState<DestinoBaixaCartao>('BANCARIA'); // rdgDestino
  const [historico, setHistorico] = useState(''); // dbmObs — vazio = "REF. BX LOTE: N"
  // os documentos do lote da baixa (cdsDoctos), pelo código do recebível
  const [lote, setLote] = useState<Map<number, CartaoRecebivel>>(new Map());
  const [pesquisando, setPesquisando] = useState(false);
  const [outrasDesp, setOutrasDesp] = useState<number | undefined>(undefined); // edtOutrasDesp (UbaixaCartao.pas:1151)
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<'N' | 'S' | ''>('N'); // aberto / baixado / todos
  const [valor, setValor] = useState<number | undefined>();
  const [oper, setOper] = useState('');
  const [dtvenda, setDtvenda] = useState('');
  const [cupom, setCupom] = useState('');
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    // os abertos a baixar vêm da Pesquisa (o lote); a consulta é dos baixados ou de todos
    if (filtro === 'N') { setLista([]); setCarregando(false); return; }
    setCarregando(true);
    try {
      setLista(await listarCartoes(filtro));
    } catch (e) { mensagem.erro(e); } finally { setCarregando(false); }
  }, [mensagem, filtro]);
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
    try {
      await excluirCartao(id);
      mensagem.sucesso('Recebível excluído.'); await carregar();
    } catch (e) {
      // "Documento já conciliado na tesouraria" — só com a senha administrativa
      if ((e as { envelope?: { code?: string } })?.envelope?.code === 'CARTAO_CONCILIADO_EXCLUSAO') {
        const senha = window.prompt('Documento já conciliado na tesouraria. Informe a senha administrativa para excluir:');
        if (!senha) return;
        try { await excluirCartao(id, senha); mensagem.sucesso('Recebível excluído.'); await carregar(); } catch (e2) { mensagem.erro(e2); }
        return;
      }
      mensagem.erro(e);
    }
  };

  // os marcados na Pesquisa entram nos documentos do lote — o que já está não repete (o Locate('CODIGO') do setDocumentos)
  const adicionarAoLote = (rows: Record<string, any>[]) => {
    setPesquisando(false);
    setLote((antes) => {
      const n = new Map(antes);
      for (const r of rows) { const c = recebivelDaPesquisa(r); if (Number.isFinite(c.codvendcartao) && !n.has(c.codvendcartao)) n.set(c.codvendcartao, c); }
      return n;
    });
  };
  const removerDoLote = (id: number) => setLote((antes) => { const n = new Map(antes); n.delete(id); return n; });

  const baixarLote = async () => {
    if (busy) return;
    if (!contaBaixa) { window.alert('É necessário informar a conta corrente!'); return; }
    if (!dataBaixa) { window.alert('Informe a data da baixa.'); return; }
    const ids = [...lote.keys()];
    if (!ids.length) { window.alert('Adicione os recebíveis a baixar (Iniciar baixa).'); return; }
    if (!window.confirm(`Baixar ${ids.length} recebível(is) em ${dia(dataBaixa)}? O líquido entra na conta de destino e sai da conta da forma de pagamento.`)) return;
    setBusy(true);
    try {
      const r = await baixarCartoes({ codconta: Number(contaBaixa), codvendcartaos: ids, dataBaixa, destino, historico: historico.trim() || undefined, outrasDespesas: outrasDesp });
      setOutrasDesp(undefined); setHistorico(''); setLote(new Map());
      mensagem.sucesso(`Documentos baixados com sucesso — lote ${r.idlote}, ${r.itens} recebível(is); líquido ${brl(r.total_liquido)} creditado (taxa ${brl(r.total_taxa)}${r.outras_despesas ? `, outras despesas ${brl(r.outras_despesas)}` : ''})${r.contabilizado ? '; integrado na contabilidade' : ''}.`);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  // a consulta do lote (FRMCONSCRTBX): os cartões baixados, os recursos utilizados e o "Reverter baixa"
  const consultarLote = (idlote?: number) => navigate(idlote ? `/financeiro/cartoes/consulta-baixa?lote=${idlote}` : '/financeiro/cartoes/consulta-baixa');

  const linhas = filtro === 'N' ? [...lote.values()] : lista;
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
    { field: 'acoes', headerName: '', type: 'actions', width: 150, getActions: ({ row }: { row: CartaoRecebivel }) => (row.liberado === 'S'
      ? (row.idlote && pode('BTNCONSULTA') ? [{ id: 'lote', label: `Consultar lote ${row.idlote}`, onClick: (r: CartaoRecebivel) => consultarLote(Number(r.idlote)) }] : [])
      : [
        ...(filtro === 'N' ? [{ id: 'rem', label: 'Tirar do lote', onClick: (r: CartaoRecebivel) => removerDoLote(Number(r.codvendcartao)) }] : []),
        { id: 'del', label: 'Excluir', onClick: (r: CartaoRecebivel) => void excluir(Number(r.codvendcartao)) },
      ]) },
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
            <div className="w-64"><SelectField label="Conta corrente" value={contaBaixa} onChange={setContaBaixa} options={contas.filter((c) => destino === 'TESOURARIA' || !c.caixa).map((c) => ({ value: String(c.codconta), label: `${c.codconta} · ${c.nroconta ?? ''} ${c.titular ?? ''}`.trim() }))} placeholder="(conta de destino)" /></div>
            <div className="w-40"><DateField label="Data da baixa" value={dataBaixa} onChange={(v) => setDataBaixa(v ?? '')} /></div>
            <div className="w-40"><NumberField label="Outras despesas" value={outrasDesp} onChange={setOutrasDesp} decimais={2} min={0} /></div>
            <div className="w-64"><Field label="&Histórico" value={historico} onChange={(e) => setHistorico(e.target.value)} placeholder="ex.: AMEX — vira «AMEX REF. BX LOTE: nº»" /></div>
            <Button label={lote.size ? '&Adicionar cartões' : 'Iniciar baix&a'} variant="soft" disabled={busy} onClick={() => setPesquisando(true)} />
            <Button label="&Baixar o lote" variant="soft" disabled={busy || !lote.size} onClick={() => void baixarLote()} />
          </>
        )}
        {/* "Consulta &titulos" (btnConsulta, Tag 1, UbaixaCartao.pas:933): a consulta do lote; desabilitado com uma baixa em andamento */}
        <Button label="Consulta &títulos" variant="ghost" disabled={busy || lote.size > 0 || !pode('BTNCONSULTA')} onClick={() => consultarLote()} />
        <div className="flex-1 text-right text-body-sm text-fg-muted">
          Bruto <b className="text-fg">{brl(totalBruto)}</b> · Líquido <b className="text-fg">{brl(totalLiq)}</b> · {linhas.length} recebível(is)
          {filtro === 'N' ? ' no lote' : linhas.length >= TETO_CONSULTA_CARTOES ? ` (os ${TETO_CONSULTA_CARTOES} mais recentes)` : ''}
        </div>
      </div>
      <DataTable columns={colunas} rows={linhas} loading={carregando} getRowId={(r) => Number(r.codvendcartao)} />
      {pesquisando && (
        <Pesquisa resourcePath="financeiro/cartao-baixa" multisselecao onSelecionarVarios={adicionarAoLote}
          onSelecionar={(r) => adicionarAoLote([r])} onFechar={() => setPesquisando(false)} />
      )}
    </div>
  );
}
