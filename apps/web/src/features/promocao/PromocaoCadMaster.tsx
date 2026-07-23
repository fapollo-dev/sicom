import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Trash2, X } from 'lucide-react';
import type { Promocao, PromocaoItemDto } from '@apollo/shared';
import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { listarPromocoes, criarPromocao, removerPromocao } from './promocaoApi';

const n = (v: unknown) => Number(v) || 0;
const fmtMoeda = (v: unknown) => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDt = (v: unknown) => (v ? new Date(String(v)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/**
 * MECÂNICA (PROMOCAO.TIPO) → aba do PageControl do legado (UCadPromocao.dfm: Tbs*). O seletor "Tipo" escolhe a
 * aba; cada aba tem os campos daquela mecânica. corte-1 entrega a aba PREÇO FIXO ('P', ORIGEM='P'): produto +
 * preço fixo. As demais abas ficam para os próximos cortes (mostram um aviso, sem travar o cadastro do header).
 */
const TIPOS = [
  { value: 'C', label: 'Categoria' },
  { value: 'O', label: 'Combo' },
  { value: 'A', label: 'Atacarejo' },
  { value: 'B', label: 'Bonificação' },
  { value: 'F', label: 'Desconto Fixo' },
  { value: 'V', label: 'Desconto Variável' },
  { value: 'D', label: 'Desconto Adicional' },
  { value: 'P', label: 'Preço Fixo' },
  { value: 'G', label: 'Produto Grátis' },
  { value: 'L', label: 'Leve Pague' },
  { value: 'R', label: 'Código Promocional' },
];
const TIPO_LABEL: Record<string, string> = Object.fromEntries(TIPOS.map((t) => [t.value, t.label]));
/** Destino (público) — UCadPromocao "Destino". */
const DESTINOS = [
  { value: 'T', label: 'Todos' },
  { value: 'C', label: 'Clientes' },
  { value: 'U', label: 'Clube' },
  { value: 'F', label: 'Funcionários' },
  { value: 'P', label: 'Perfil' },
  { value: 'I', label: 'Izio' },
];
/** cortes já implementados (aba funcional). Fora daqui: aviso "próximo corte". */
const ABAS_PRONTAS = new Set(['P']);

export function PromocaoCadMaster() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<Promocao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // cabeçalho
  const [descricao, setDescricao] = useState('');
  const [tipo, setTipo] = useState<string>('P'); // aba ativa (default Preço Fixo — a do corte-1)
  const [destino, setDestino] = useState<string | undefined>('T');
  const [empresas, setEmpresas] = useState('');
  const [dtini, setDtini] = useState('');
  const [dtfim, setDtfim] = useState('');
  const [itens, setItens] = useState<PromocaoItemDto[]>([]);

  // adder da aba Preço Fixo
  const [idproduto, setIdproduto] = useState<number | undefined>(undefined);
  const [preco, setPreco] = useState<number | undefined>(undefined);

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
      setLista(await listarPromocoes({ orderBy: 'idpromocao', orderDir: 'desc' }));
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);
  useEffect(() => void recarregar(), [recarregar]);

  const adicionarPrecoFixo = () => {
    if (idproduto == null) return mensagem.erro('Selecione o produto.');
    if (!(n(preco) > 0)) return mensagem.erro('Informe o preço fixo (> 0).');
    if (itens.some((it) => it.origem === 'P' && Number(it.idorigempromocao) === idproduto))
      return mensagem.erro('Produto já está na lista.');
    // TIPO fica NULL p/ Preço Fixo (golden origem='P' tem TIPO NULL — o $/% é da mecânica de desconto, não daqui).
    setItens((xs) => [...xs, { origem: 'P', idorigempromocao: idproduto, valor: n(preco), ativo: 'S' } as PromocaoItemDto]);
    setIdproduto(undefined);
    setPreco(undefined);
  };
  const removerItem = (i: number) => setItens((xs) => xs.filter((_, idx) => idx !== i));

  // trocar a mecânica (aba) LIMPA os itens — senão itens de uma aba ficariam pendurados e seriam gravados
  // numa promoção de outro TIPO (header/detalhe divergentes). Fiel ao PageControl do legado (cada aba, seus dados).
  const trocarTipo = (v: string) => {
    setTipo(v || 'P');
    setItens([]);
    setIdproduto(undefined);
    setPreco(undefined);
  };

  const gravar = async () => {
    if (!descricao.trim()) return mensagem.erro('Informe a descrição da promoção.');
    if (tipo === 'P' && !itens.length) return mensagem.erro('Adicione ao menos um item (produto + preço fixo).');
    setSalvando(true);
    try {
      // datetime-local é wall-clock sem fuso → ISO com o offset do navegador (fold de timezone da Agenda).
      const iso = (s: string) => (s ? new Date(s).toISOString() : undefined);
      await criarPromocao({
        descricao: descricao.trim(),
        tipo: tipo as any,
        datainicio: iso(dtini),
        datafim: iso(dtfim),
        destino: destino as any,
        empresas: empresas.trim() || undefined,
        // só envia itens da aba PRONTA — abas não-convertidas gravam apenas o cabeçalho (nunca itens órfãos).
        itens: ABAS_PRONTAS.has(tipo) ? itens : [],
      } as any);
      mensagem.sucesso('Promoção gravada.');
      setDescricao(''); setDestino('T'); setEmpresas(''); setDtini(''); setDtfim(''); setItens([]);
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

  const colunas = useMemo<DataTableColumnDef<Promocao>[]>(() => [
    { field: 'idpromocao', headerName: 'Cód.', type: 'number', width: 80, isPrimary: true },
    { field: 'descricao', headerName: 'Descrição', type: 'text' },
    { field: 'tipo', headerName: 'Mecânica', type: 'text', width: 150, valueGetter: (r) => TIPO_LABEL[String(r.tipo)] ?? String(r.tipo ?? '') },
    { field: 'datainicio', headerName: 'Início', type: 'text', width: 150, valueGetter: (r) => fmtDt(r.datainicio) },
    { field: 'datafim', headerName: 'Fim', type: 'text', width: 150, valueGetter: (r) => fmtDt(r.datafim) },
    { field: 'qtde_itens', headerName: 'Itens', type: 'number', width: 80 },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 90,
      getActions: ({ row: r }: { row: Promocao }) => [
        { id: 'excluir', label: 'Excluir', icon: <Trash2 size={16} />, destructive: true, onClick: () => void acao(() => removerPromocao(Number(r.idpromocao)), 'Promoção excluída.') },
      ],
    },
  ], []);

  const itensColunas = useMemo<DataTableColumnDef<PromocaoItemDto & { _i: number }>[]>(() => [
    { field: 'idorigempromocao', headerName: 'Produto', type: 'text', isPrimary: true, valueGetter: (r) => rotuloProduto(r.idorigempromocao) },
    { field: 'valor', headerName: 'Preço Fixo', type: 'text', width: 140, valueGetter: (r) => fmtMoeda(r.valor) },
    {
      field: 'rem', headerName: '', type: 'actions', width: 60,
      getActions: ({ row: r }: { row: PromocaoItemDto & { _i: number } }) => [
        { id: 'rem', label: 'Remover', icon: <X size={16} />, destructive: true, onClick: () => removerItem(r._i) },
      ],
    },
  ], [rotuloProduto]);

  const itensPrecoFixo = itens.map((it, _i) => ({ ...it, _i })).filter((it) => it.origem === 'P');

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Gestão de Promoções" />

      {/* Cabeçalho da promoção */}
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-6">
          <div className="sm:col-span-3"><Field label="&Descrição" value={descricao} maxLength={150} onChange={(e) => setDescricao(e.target.value)} /></div>
          <div className="sm:col-span-2"><SelectField label="&Tipo" options={TIPOS} value={tipo} onChange={trocarTipo} /></div>
          <div className="sm:col-span-1"><SelectField label="D&estino" options={DESTINOS} value={destino} onChange={(v) => setDestino(v || undefined)} placeholder="—" /></div>
          <label className="flex flex-col gap-gp-2xs text-body-sm sm:col-span-2">
            <span className="text-fg-muted">Início (data e hora)</span>
            <input type="datetime-local" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={dtini} onChange={(e) => setDtini(e.target.value)} />
          </label>
          <label className="flex flex-col gap-gp-2xs text-body-sm sm:col-span-2">
            <span className="text-fg-muted">Fim (data e hora)</span>
            <input type="datetime-local" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={dtfim} onChange={(e) => setDtfim(e.target.value)} />
          </label>
          <div className="sm:col-span-2"><Field label="E&mpresas (CSV)" value={empresas} maxLength={50} placeholder="ex.: 1,50" onChange={(e) => setEmpresas(e.target.value)} /></div>
        </div>

        {/* Aba da mecânica (PageControl do legado) — corte-1: Preço Fixo funcional; demais avisam */}
        <div className="mt-form-gap rounded-radius-base border border-border-subtle bg-bg-subtle p-pad-sm">
          <div className="mb-form-gap text-body-sm font-semibold text-fg-default">Aba: {TIPO_LABEL[tipo]}</div>

          {ABAS_PRONTAS.has(tipo) ? (
            <>
              <div className="grid grid-cols-1 items-end gap-form-gap sm:grid-cols-6">
                <div className="sm:col-span-3"><SelectField label="&Produto" options={produtoOptions} value={idproduto != null ? String(idproduto) : undefined} onChange={(v) => setIdproduto(v ? Number(v) : undefined)} placeholder="Selecione…" /></div>
                <div className="sm:col-span-2"><CurrencyField label="Preço &Fixo" value={preco} onChange={setPreco} /></div>
                <div className="flex items-end justify-end sm:col-span-1"><Button label="&Adicionar" variant="soft" onClick={adicionarPrecoFixo} /></div>
              </div>
              {itensPrecoFixo.length > 0 && (
                <div className="mt-form-gap overflow-x-auto">
                  <DataTable rows={itensPrecoFixo} columns={itensColunas} getRowId={(r) => String(r._i)} />
                </div>
              )}
            </>
          ) : (
            <p className="text-body-sm text-fg-muted">
              A mecânica <strong>{TIPO_LABEL[tipo]}</strong> entra em um próximo corte. O cabeçalho da promoção já pode ser
              gravado; os itens desta aba serão habilitados quando ela for convertida.
            </p>
          )}
        </div>

        <div className="mt-form-gap flex justify-end">
          <Button label={salvando ? 'Gravando…' : 'Gravar promoção'} disabled={salvando} onClick={() => void gravar()} />
        </div>
      </section>

      {/* Lista de promoções */}
      <DataTable rows={lista} columns={colunas} loading={carregando} getRowId={(r) => String(r.idpromocao)} />
    </div>
  );
}
