import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { CheckCircle2, RotateCcw, Trash2, X } from 'lucide-react';
import type { AgendaPromocao, AgendaPromocaoItemDto } from '@apollo/shared';
import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { listarAgendas, criarAgenda, encerrarAgenda, reabrirAgenda, removerAgenda } from './agendaPromocaoApi';

const n = (v: unknown) => Number(v) || 0;
const fmtMoeda = (v: unknown) => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDt = (v: unknown) => (v ? new Date(String(v)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const SIT_LABEL: Record<string, string> = { AGENDADA: 'Agendada', VIGENTE: 'Vigente', EXPIRADA: 'Expirada', ENCERRADA: 'Encerrada' };

/**
 * AGENDA DE PROMOÇÃO (uCadAgendaPromocao) — corte-1: cadastro (nome + período data+hora + itens produto/preço)
 * + lista com workflow (encerrar/reabrir/excluir). SEM efeito (a aplicação ao preço vigente é o corte-2).
 */
export function AgendaPromocaoCadMaster() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<AgendaPromocao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [nome, setNome] = useState('');
  const [dtini, setDtini] = useState('');
  const [dtfim, setDtfim] = useState('');
  const [itens, setItens] = useState<AgendaPromocaoItemDto[]>([]);
  // linha em edição do adder
  const [idproduto, setIdproduto] = useState<number | undefined>(undefined);
  const [vlrpromocao, setVlrpromocao] = useState<number | undefined>(undefined);
  const [vrclube, setVrclube] = useState<number | undefined>(undefined);
  const [maximo, setMaximo] = useState<number | undefined>(undefined);

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

  const adicionarItem = () => {
    if (idproduto == null) return mensagem.erro('Selecione o produto.');
    if (!(n(vlrpromocao) > 0)) return mensagem.erro('Informe o preço promocional (> 0).');
    if (itens.some((it) => it.idproduto === idproduto)) return mensagem.erro('Produto já está na lista.');
    setItens((xs) => [...xs, { idproduto, vlrpromocao: n(vlrpromocao), vrclube_fidelidade: vrclube, maximo }]);
    setIdproduto(undefined); setVlrpromocao(undefined); setVrclube(undefined); setMaximo(undefined);
  };
  const removerItem = (id: number) => setItens((xs) => xs.filter((it) => it.idproduto !== id));

  const gravar = async () => {
    if (!nome.trim()) return mensagem.erro('Informe o nome da promoção.');
    if (!dtini || !dtfim) return mensagem.erro('Informe o período (início e fim).');
    if (!itens.length) return mensagem.erro('Adicione ao menos um item.');
    setSalvando(true);
    try {
      await criarAgenda({ nomepromo: nome.trim(), dtiniciopromocao: dtini, dtfimpromocao: dtfim, itens });
      mensagem.sucesso('Promoção gravada.');
      setNome(''); setDtini(''); setDtfim(''); setItens([]);
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
          encerrada
            ? { id: 'reabrir', label: 'Reabrir', icon: <RotateCcw size={16} />, onClick: () => void acao(() => reabrirAgenda(id), 'Promoção reaberta.') }
            : { id: 'encerrar', label: 'Encerrar', icon: <CheckCircle2 size={16} />, onClick: () => void acao(() => encerrarAgenda(id), 'Promoção encerrada.') },
          { id: 'excluir', label: 'Excluir', icon: <Trash2 size={16} />, destructive: true, onClick: () => void acao(() => removerAgenda(id), 'Promoção excluída.') },
        ];
      },
    },
  ], []);

  const itensColunas = useMemo<DataTableColumnDef<AgendaPromocaoItemDto>[]>(() => [
    { field: 'idproduto', headerName: 'Produto', type: 'text', isPrimary: true, valueGetter: (r) => rotuloProduto(r.idproduto) },
    { field: 'vlrpromocao', headerName: 'Preço promo', type: 'text', width: 130, valueGetter: (r) => fmtMoeda(r.vlrpromocao) },
    { field: 'vrclube_fidelidade', headerName: 'Preço clube', type: 'text', width: 130, valueGetter: (r) => (n(r.vrclube_fidelidade) > 0 ? fmtMoeda(r.vrclube_fidelidade) : '—') },
    { field: 'maximo', headerName: 'Máx./venda', type: 'number', width: 110, valueGetter: (r) => (n(r.maximo) > 0 ? n(r.maximo) : '—') },
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

      {/* Formulário de nova agenda */}
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
          <div className="sm:col-span-3"><Field label="&Nome da promoção" value={nome} maxLength={200} onChange={(e) => setNome(e.target.value)} /></div>
          <label className="flex flex-col gap-gp-2xs text-body-sm">
            <span className="text-fg-muted">Início (data e hora)</span>
            <input type="datetime-local" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={dtini} onChange={(e) => setDtini(e.target.value)} />
          </label>
          <label className="flex flex-col gap-gp-2xs text-body-sm">
            <span className="text-fg-muted">Fim (data e hora)</span>
            <input type="datetime-local" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={dtfim} onChange={(e) => setDtfim(e.target.value)} />
          </label>
        </div>

        {/* Adder de itens */}
        <div className="mt-form-gap grid grid-cols-1 items-end gap-form-gap sm:grid-cols-5">
          <div className="sm:col-span-2">
            <SelectField label="&Produto" options={produtoOptions} value={idproduto != null ? String(idproduto) : undefined} onChange={(v) => setIdproduto(v ? Number(v) : undefined)} placeholder="Selecione…" />
          </div>
          <CurrencyField label="&Preço promo" value={vlrpromocao} onChange={setVlrpromocao} />
          <CurrencyField label="Preço &clube" value={vrclube} onChange={setVrclube} />
          <div className="flex items-end gap-gp-sm">
            <NumberField label="&Máx." value={maximo} onChange={setMaximo} decimais={3} min={0} />
            <Button label="Adicionar" variant="soft" onClick={adicionarItem} />
          </div>
        </div>

        {itens.length > 0 && (
          <div className="mt-form-gap">
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
