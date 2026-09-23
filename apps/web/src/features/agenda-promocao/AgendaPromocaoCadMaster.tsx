import { useCallback, useEffect, useMemo, useState } from 'react';
import { gradeLayoutService } from '../../shared/grade/savedViewsService';
import { DataTable, type DataTableColumnDef, FormFieldCheckbox, PageHeader } from '@apollosg/design-system';
import { CheckCircle2, Pencil, RotateCcw, Trash2, X, Tag } from 'lucide-react';
import { STATUS_AGENDA_PROMOCAO, type AgendaPromocao, type AgendaPromocaoItemDto } from '@apollo/shared';
import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { TextArea } from '../../shared/ui/TextArea';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { listarAgendas, criarAgenda, atualizarAgenda, obterAgenda, encerrarAgenda, reabrirAgenda, removerAgenda, aplicarAgenda } from './agendaPromocaoApi';

const n = (v: unknown) => Number(v) || 0;
const fmtMoeda = (v: unknown) => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDt = (v: unknown) => (v ? new Date(String(v)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const simNao = (v: unknown) => (String(v) === 'S' || String(v) === 'T' ? '✓' : '—');
/** flags de mídia: 'T'/'F' no legado; o CheckboxField fala 'S'/'N' */
const tfParaSn = (v: unknown): 'S' | 'N' => (String(v) === 'T' || String(v) === 'S' ? 'S' : 'N');
const snParaTf = (v: 'S' | 'N'): 'T' | 'F' => (v === 'S' ? 'T' : 'F');
const SIT_LABEL: Record<string, string> = { AGENDADA: 'Agendada', VIGENTE: 'Vigente', EXPIRADA: 'Expirada', ENCERRADA: 'Encerrada' };
// Status (FLAGPROMOCAO) — o combo cbbStatus do legado: N = ABERTA · E = EXECUTANDO · J = FECHADA (uCadAgendaPromocao.dfm:505)
const STATUS_OPCOES = (Object.entries(STATUS_AGENDA_PROMOCAO) as Array<[string, string]>).map(([value, label]) => ({ value, label }));
/** o que o combo deixa escolher (cbbStatusExit:1088): ABERTA não muda; de EXECUTANDO ou FECHADA, só volta a ABERTA */
const statusPermitidos = (atual: string | undefined) =>
  STATUS_OPCOES.filter((o) => o.value === atual || (atual !== 'N' && atual != null && o.value === 'N'));
/** ISO do servidor → valor do <input type="datetime-local"> no fuso do navegador */
const paraLocal = (iso: unknown) => {
  if (!iso) return '';
  const d = new Date(String(iso));
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * AGENDA DE PROMOÇÃO (uCadAgendaPromocao) — cabeçalho (nome + Status + Opções + Observação + período data+hora +
 * LOJAS) + itens (produto + Vr.Venda + Vr.Promocional + Vr.Fidelidade + Máx + Mín.compra + mídia + Ativo) + lista da
 * REDE com workflow (editar/aplicar/encerrar/reabrir/excluir).
 * mig 312: as lojas participantes (obrigatórias — "Selecione as Empresas participantes") valem para todos os itens; o
 * status é o ciclo do legado ABERTA → EXECUTANDO → FECHADA, e o combo só deixa voltar a ABERTA.
 * ADIADO (documentado): Grupo-Preço/Atualizar-Grupo/Departamento, % promoção/% fidelidade, relatórios/Clonar/
 * Etiquetas/Histórico ("Outros").
 */
export function AgendaPromocaoCadMaster() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<AgendaPromocao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // cabeçalho
  const [editando, setEditando] = useState<number | null>(null);
  const [statusAtual, setStatusAtual] = useState<string | undefined>(undefined);
  const [lojas, setLojas] = useState<number[]>([]);
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
  const { data: empresaOptions = [] } = useResourceOptions('cadastro/empresas', (e: any) => ({
    value: String(e.idempresa ?? e.codempresa), label: `${e.idempresa ?? e.codempresa} - ${e.fantasia ?? e.razao_social ?? ''}`,
  }));
  const alternarLoja = (id: number, marcada: boolean) =>
    setLojas((xs) => (marcada ? [...new Set([...xs, id])].sort((a, b) => a - b) : xs.filter((x) => x !== id)));
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
        maximo, vlr_min_compra: minCompra, ativo: 'S', tv: snParaTf(tv), radio: snParaTf(radio), tabloide: snParaTf(tabloide), interno: snParaTf(interno),
      } as AgendaPromocaoItemDto,
    ]);
    limparAdder();
  };
  const removerItem = (id: number) => setItens((xs) => xs.filter((it) => it.idproduto !== id));
  // "Marcar produto como ativo/inativo" (uCadAgendaPromocao:1412/1446) — vale ao gravar
  const alternarAtivo = (id: number) =>
    setItens((xs) => xs.map((it) => (it.idproduto === id ? { ...it, ativo: it.ativo === 'N' ? 'S' : 'N' } : it)));

  const limparForm = () => {
    setEditando(null); setStatusAtual(undefined); setLojas([]);
    setNome(''); setStatus(undefined); setOpcoes(undefined); setObs(''); setDtini(''); setDtfim(''); setItens([]);
  };

  const editar = async (id: number) => {
    try {
      const a = await obterAgenda(id);
      setEditando(id);
      setStatusAtual(a.flagpromocao ?? undefined);
      setStatus(a.flagpromocao ?? undefined);
      setLojas(Array.isArray(a.empresas) ? a.empresas.map(Number) : []);
      setNome(a.nomepromo ?? ''); setOpcoes(a.opcoes ?? undefined); setObs(a.obs ?? '');
      setDtini(paraLocal(a.dtiniciopromocao)); setDtfim(paraLocal(a.dtfimpromocao));
      setItens((a.itens ?? []).map((it) => ({
        idproduto: Number(it.idproduto), vlrpromocao: n(it.vlrpromocao), vrvenda: it.vrvenda != null ? n(it.vrvenda) : undefined,
        vrclube_fidelidade: it.vrclube_fidelidade != null ? n(it.vrclube_fidelidade) : undefined,
        maximo: it.maximo != null ? n(it.maximo) : undefined, vlr_min_compra: it.vlr_min_compra != null ? n(it.vlr_min_compra) : undefined,
        ativo: it.ativo === 'N' ? 'N' : 'S', tv: snParaTf(tfParaSn(it.tv)), radio: snParaTf(tfParaSn(it.radio)),
        tabloide: snParaTf(tfParaSn(it.tabloide)), interno: snParaTf(tfParaSn(it.interno)),
      }) as AgendaPromocaoItemDto));
    } catch (e) {
      mensagem.erro(e);
    }
  };

  const gravar = async () => {
    if (!nome.trim()) return mensagem.erro('Informe o nome da promoção.');
    if (!lojas.length) return mensagem.erro('Selecione as empresas participantes.');
    if (!dtini || !dtfim) return mensagem.erro('Informe o período (início e fim).');
    if (!itens.length) return mensagem.erro('Não é possivel gravar uma agenda vazia!');
    setSalvando(true);
    try {
      // fold auditoria (timezone): datetime-local é wall-clock SEM fuso; converte p/ ISO com offset do navegador.
      const iso = (s: string) => new Date(s).toISOString();
      const dto = {
        nomepromo: nome.trim(), dtiniciopromocao: iso(dtini), dtfimpromocao: iso(dtfim),
        opcoes, obs: obs.trim() || undefined, empresas: lojas, itens,
      };
      if (editando != null) {
        await atualizarAgenda(editando, { ...dto, ...(status && status !== statusAtual ? { flagpromocao: status as 'N' | 'E' | 'J' } : {}) });
      } else {
        await criarAgenda(dto);
      }
      mensagem.sucesso('Alterações gravadas com sucesso!');
      limparForm();
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
    { field: 'empresas', headerName: 'Lojas', type: 'text', width: 100 },
    { field: 'status', headerName: 'Status', type: 'text', width: 120 },
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
          ...(encerrada ? [] : [{ id: 'editar', label: 'Editar', icon: <Pencil size={16} />, onClick: () => void editar(id) }]),
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      field: 'rem', headerName: '', type: 'actions', width: 90,
      getActions: ({ row: r }: { row: AgendaPromocaoItemDto }) => [
        { id: 'ativo', label: r.ativo === 'N' ? 'Marcar como ativo' : 'Marcar como inativo', icon: <CheckCircle2 size={16} />, onClick: () => alternarAtivo(r.idproduto) },
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
          <div className="sm:col-span-1">
            {/* agenda nova nasce ABERTA e o combo fica desabilitado enquanto ABERTA (uCadAgendaPromocao:517) */}
            <SelectField label="&Status" options={editando != null ? statusPermitidos(statusAtual) : STATUS_OPCOES.filter((o) => o.value === 'N')}
              value={editando != null ? status : 'N'} onChange={(v) => setStatus(v || undefined)} disabled={editando == null || statusAtual === 'N'} />
          </div>
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
          <fieldset className="flex flex-col gap-gp-2xs sm:col-span-6">
            <legend className="text-body-sm text-fg-muted">Empresas participantes (o preço promocional vale nestas lojas)</legend>
            <div className="flex flex-wrap gap-gp-md">
              {empresaOptions.map((o) => (
                <FormFieldCheckbox key={o.value} label={o.label} checked={lojas.includes(Number(o.value))}
                  onCheckedChange={(c) => alternarLoja(Number(o.value), !!c)} />
              ))}
            </div>
          </fieldset>
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
            <DataTable persistId="agenda-promocao" savedViewsService={gradeLayoutService} rows={itens} columns={itensColunas} getRowId={(r) => String(r.idproduto)} />
          </div>
        )}

        <div className="mt-form-gap flex justify-end gap-gp-sm">
          {editando != null && <Button label="&Cancelar" variant="ghost" onClick={limparForm} />}
          <Button label={salvando ? 'Gravando…' : editando != null ? `Gravar agenda ${editando}` : 'Gravar promoção'} disabled={salvando} onClick={() => void gravar()} />
        </div>
      </section>

      {/* Lista de agendas */}
      <DataTable persistId="agenda-promocao-2" savedViewsService={gradeLayoutService} rows={lista} columns={colunas} loading={carregando} getRowId={(r) => String(r.codagenda)} />
    </div>
  );
}
