import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { CheckCircle2, RotateCcw, Trash2, X, Tag } from 'lucide-react';
import type { AgendaPromocao, AgendaPromocaoItemDto } from '@apollo/shared';
import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { TextArea } from '../../shared/ui/TextArea';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { listarAgendas, criarAgenda, encerrarAgenda, reabrirAgenda, removerAgenda, aplicarAgenda } from './agendaPromocaoApi';

const n = (v: unknown) => Number(v) || 0;
const fmtMoeda = (v: unknown) => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDt = (v: unknown) => (v ? new Date(String(v)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const simNao = (v: unknown) => (String(v) === 'S' ? '✓' : '—');
const SIT_LABEL: Record<string, string> = { AGENDADA: 'Agendada', VIGENTE: 'Vigente', EXPIRADA: 'Expirada', ENCERRADA: 'Encerrada' };
// Status (FLAGPROMOCAO, 1 char) — combo do legado (uCadAgendaPromocao "Status"). Valores prováveis; ajustável.
const STATUS_OPCOES = [
  { value: 'A', label: 'A - Ativa' },
  { value: 'I', label: 'I - Inativa' },
  { value: 'P', label: 'P - Programada' },
];

/**
 * AGENDA DE PROMOÇÃO (uCadAgendaPromocao) — conversão FIEL do form: cabeçalho (nome + Status + Opções +
 * Observação + período data+hora) + itens (produto + Vr.Venda + Vr.Promocional + Vr.Fidelidade + Máx +
 * Mín.compra + mídia TV/Rádio/Tabloide/Interno + Ativo) + lista com workflow (aplicar/encerrar/reabrir/excluir).
 * ADIADO (documentado): Empresas-da-agenda (multi-empresa; backend é single empresaScoped), Grupo-Preço/
 * Atualizar-Grupo/Departamento (derivados do produto), % promoção/% fidelidade (helpers globais), e os relatórios/
 * Clonar/Etiquetas/Histórico ("Outros" — dependem de infra de relatório).
 */
export function AgendaPromocaoCadMaster() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<AgendaPromocao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // cabeçalho
  const [nome, setNome] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [opcoes, setOpcoes] = useState<number | undefined>(undefined);
  const [obs, setObs] = useState('');
  const [dtini, setDtini] = useState('');
  const [dtfim, setDtfim] = useState('');
  const [itens, setItens] = useState<AgendaPromocaoItemDto[]>([]);

  // linha em edição do adder de itens
  const [idproduto, setIdproduto] = useState<number | undefined>(undefined);
  const [vrvenda, setVrvenda] = useState<number | undefined>(undefined);
  const [vlrpromocao, setVlrpromocao] = useState<number | undefined>(undefined);
  const [vrclube, setVrclube] = useState<number | undefined>(undefined);
  const [maximo, setMaximo] = useState<number | undefined>(undefined);
  const [minCompra, setMinCompra] = useState<number | undefined>(undefined);
  const [tv, setTv] = useState<'S' | 'N'>('N');
  const [radio, setRadio] = useState<'S' | 'N'>('N');
  const [tabloide, setTabloide] = useState<'S' | 'N'>('N');
  const [interno, setInterno] = useState<'S' | 'N'>('N');

  const { data: produtoOptions = [] } = useResourceOptions(
    'cadastro/produtos',
    (p: any) => ({ value: String(p.idproduto ?? p.codigo), label: `${p.idproduto ?? p.codigo} - ${p.descricao ?? ''}` }),
    { campo: 'ativo', operador: 'igual', valor: 'S' },
  );
  const rotuloProduto = useCallback(
    (id: unknown) => produtoOptions.find((o) => String(o.value) === String(id))?.label ?? String(id ?? ''),
    [produtoOptions],
  );

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setLista(await listarAgendas({ orderBy: 'codagenda', orderDir: 'desc' }));
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);
  useEffect(() => void recarregar(), [recarregar]);

  const limparAdder = () => {
    setIdproduto(undefined); setVrvenda(undefined); setVlrpromocao(undefined); setVrclube(undefined);
    setMaximo(undefined); setMinCompra(undefined); setTv('N'); setRadio('N'); setTabloide('N'); setInterno('N');
  };

  const adicionarItem = () => {
    if (idproduto == null) return mensagem.erro('Selecione o produto.');
    // regra fiel ao legado (uCadAgendaPromocao:651): aceita preço promo=0 se houver preço de clube (>0); rejeita ambos zero.
    if (!(n(vlrpromocao) > 0) && !(n(vrclube) > 0)) return mensagem.erro('Informe o preço promocional ou o preço do clube (> 0).');
    if (itens.some((it) => it.idproduto === idproduto)) return mensagem.erro('Produto já está na lista.');
    setItens((xs) => [
      ...xs,
      {
        idproduto, vrvenda: n(vrvenda), vlrpromocao: n(vlrpromocao), vrclube_fidelidade: vrclube,
        maximo, vlr_min_compra: minCompra, ativo: 'S', tv, radio, tabloide, interno,
      } as AgendaPromocaoItemDto,
    ]);
    limparAdder();
  };
  const removerItem = (id: number) => setItens((xs) => xs.filter((it) => it.idproduto !== id));

  const gravar = async () => {
    if (!nome.trim()) return mensagem.erro('Informe o nome da promoção.');
    if (!dtini || !dtfim) return mensagem.erro('Informe o período (início e fim).');
    if (!itens.length) return mensagem.erro('Adicione ao menos um item.');
    setSalvando(true);
    try {
      // fold auditoria (timezone): datetime-local é wall-clock SEM fuso; converte p/ ISO com offset do navegador.
      const iso = (s: string) => new Date(s).toISOString();
      await criarAgenda({
        nomepromo: nome.trim(), dtiniciopromocao: iso(dtini), dtfimpromocao: iso(dtfim),
        flagpromocao: status, opcoes, obs: obs.trim() || undefined, itens,
      });
      mensagem.sucesso('Promoção gravada.');
      setNome(''); setStatus(undefined); setOpcoes(undefined); setObs(''); setDtini(''); setDtfim(''); setItens([]);
      await recarregar();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setSalvando(false);
    }
  };

  const acao = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); mensagem.sucesso(ok); await recarregar(); } catch (e) { mensagem.erro(e); }
  };

  const colunas = useMemo<DataTableColumnDef<AgendaPromocao>[]>(() => [
    { field: 'codagenda', headerName: 'Cód.', type: 'number', width: 80, isPrimary: true },
    { field: 'nomepromo', headerName: 'Promoção', type: 'text' },
    { field: 'dtiniciopromocao', headerName: 'Início', type: 'text', width: 150, valueGetter: (r) => fmtDt(r.dtiniciopromocao) },
    { field: 'dtfimpromocao', headerName: 'Fim', type: 'text', width: 150, valueGetter: (r) => fmtDt(r.dtfimpromocao) },
    { field: 'situacao', headerName: 'Situação', type: 'text', width: 120, valueGetter: (r) => SIT_LABEL[String(r.situacao)] ?? String(r.situacao ?? '') },
    { field: 'qtde_itens', headerName: 'Itens', type: 'number', width: 80 },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 140,
      getActions: ({ row: r }: { row: AgendaPromocao }) => {
        const id = Number(r.codagenda);
        const encerrada = String(r.situacao) === 'ENCERRADA';
        return [
          ...(encerrada
            ? [{ id: 'reabrir', label: 'Reabrir', icon: <RotateCcw size={16} />, onClick: () => void acao(() => reabrirAgenda(id), 'Promoção reaberta.') }]
            : [
                { id: 'aplicar', label: 'Aplicar preços', icon: <Tag size={16} />, onClick: () => void acao(async () => { const r = await aplicarAgenda(id); return r; }, 'Preços promocionais aplicados ao catálogo.') },
                { id: 'encerrar', label: 'Encerrar', icon: <CheckCircle2 size={16} />, onClick: () => void acao(() => encerrarAgenda(id), 'Promoção encerrada (preços revertidos).') },
              ]),
          { id: 'excluir', label: 'Excluir', icon: <Trash2 size={16} />, destructive: true, onClick: () => void acao(() => removerAgenda(id), 'Promoção excluída.') },
        ];
      },
    },
  ], []);

  const itensColunas = useMemo<DataTableColumnDef<AgendaPromocaoItemDto>[]>(() => [
    { field: 'ativo', headerName: 'Ativo', type: 'text', width: 70, valueGetter: (r) => simNao(r.ativo ?? 'S') },
    { field: 'idproduto', headerName: 'Produto', type: 'text', isPrimary: true, valueGetter: (r) => rotuloProduto(r.idproduto) },
    { field: 'vrvenda', headerName: 'Vr. Venda', type: 'text', width: 120, valueGetter: (r) => (n(r.vrvenda) > 0 ? fmtMoeda(r.vrvenda) : '—') },
    { field: 'vlrpromocao', headerName: 'Vr. Promocional', type: 'text', width: 140, valueGetter: (r) => fmtMoeda(r.vlrpromocao) },
    { field: 'vrclube_fidelidade', headerName: 'Vr. Fidelidade', type: 'text', width: 130, valueGetter: (r) => (n(r.vrclube_fidelidade) > 0 ? fmtMoeda(r.vrclube_fidelidade) : '—') },
    { field: 'maximo', headerName: 'Máx.', type: 'number', width: 90, valueGetter: (r) => (n(r.maximo) > 0 ? n(r.maximo) : '—') },
    { field: 'vlr_min_compra', headerName: 'Mín. compra', type: 'text', width: 120, valueGetter: (r) => (n(r.vlr_min_compra) > 0 ? fmtMoeda(r.vlr_min_compra) : '—') },
    { field: 'tv', headerName: 'TV', type: 'text', width: 60, valueGetter: (r) => simNao(r.tv) },
    { field: 'radio', headerName: 'Rádio', type: 'text', width: 70, valueGetter: (r) => simNao(r.radio) },
    { field: 'tabloide', headerName: 'Tabloide', type: 'text', width: 80, valueGetter: (r) => simNao(r.tabloide) },
    { field: 'interno', headerName: 'Interno', type: 'text', width: 70, valueGetter: (r) => simNao(r.interno) },
    {
      field: 'rem', headerName: '', type: 'actions', width: 60,
      getActions: ({ row: r }: { row: AgendaPromocaoItemDto }) => [
        { id: 'rem', label: 'Remover', icon: <X size={16} />, destructive: true, onClick: () => removerItem(r.idproduto) },
      ],
    },
  ], [rotuloProduto]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Agenda de Promoção" />

      {/* Cabeçalho da agenda */}
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-6">
          <div className="sm:col-span-3"><Field label="&Nome da promoção" value={nome} maxLength={200} onChange={(e) => setNome(e.target.value)} /></div>
          <div className="sm:col-span-1"><SelectField label="&Status" options={STATUS_OPCOES} value={status} onChange={(v) => setStatus(v || undefined)} placeholder="—" /></div>
          <div className="sm:col-span-2"><NumberField label="&Opções" value={opcoes} onChange={setOpcoes} decimais={0} min={0} /></div>
          <label className="flex flex-col gap-gp-2xs text-body-sm sm:col-span-3">
            <span className="text-fg-muted">Início (data e hora)</span>
            <input type="datetime-local" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={dtini} onChange={(e) => setDtini(e.target.value)} />
          </label>
          <label className="flex flex-col gap-gp-2xs text-body-sm sm:col-span-3">
            <span className="text-fg-muted">Fim (data e hora)</span>
            <input type="datetime-local" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={dtfim} onChange={(e) => setDtfim(e.target.value)} />
          </label>
          <div className="sm:col-span-6"><TextArea label="O&bservação" value={obs} maxLength={4000} rows={2} onChange={(e) => setObs(e.target.value)} /></div>
        </div>

        {/* Adder de itens (produto + preços + mídia) */}
        <div className="mt-form-gap rounded-radius-base border border-border-subtle bg-bg-subtle p-pad-sm">
          <div className="grid grid-cols-1 items-end gap-form-gap sm:grid-cols-6">
            <div className="sm:col-span-2"><SelectField label="&Produto" options={produtoOptions} value={idproduto != null ? String(idproduto) : undefined} onChange={(v) => setIdproduto(v ? Number(v) : undefined)} placeholder="Selecione…" /></div>
            <CurrencyField label="Vr. &Venda" value={vrvenda} onChange={setVrvenda} />
            <CurrencyField label="Vr. &Promocional" value={vlrpromocao} onChange={setVlrpromocao} />
            <CurrencyField label="Vr. &Fidelidade" value={vrclube} onChange={setVrclube} />
            <NumberField label="&Máx." value={maximo} onChange={setMaximo} decimais={3} min={0} />
            <CurrencyField label="Mín. &compra" value={minCompra} onChange={setMinCompra} />
            <div className="flex flex-wrap items-center gap-gp-md sm:col-span-4">
              <CheckboxField label="&TV" value={tv} onChange={setTv} />
              <CheckboxField label="&Rádio" value={radio} onChange={setRadio} />
              <CheckboxField label="Ta&bloide" value={tabloide} onChange={setTabloide} />
              <CheckboxField label="&Interno" value={interno} onChange={setInterno} />
            </div>
            <div className="flex items-end justify-end gap-gp-sm sm:col-span-2">
              <Button label="&Limpar" variant="ghost" onClick={limparAdder} />
              <Button label="&Adicionar" variant="soft" onClick={adicionarItem} />
            </div>
          </div>
        </div>

        {itens.length > 0 && (
          <div className="mt-form-gap overflow-x-auto">
            <DataTable rows={itens} columns={itensColunas} getRowId={(r) => String(r.idproduto)} />
          </div>
        )}

        <div className="mt-form-gap flex justify-end">
          <Button label={salvando ? 'Gravando…' : 'Gravar promoção'} disabled={salvando} onClick={() => void gravar()} />
        </div>
      </section>

      {/* Lista de agendas */}
      <DataTable rows={lista} columns={colunas} loading={carregando} getRowId={(r) => String(r.codagenda)} />
    </div>
  );
}
