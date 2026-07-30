import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  listarOperadoras, obterOperadora, criarOperadora, atualizarOperadora, excluirOperadora,
  type Operadora, type OperadoraDetalhe, type OperadoraTaxa,
} from './cartaoApi';

const TIPOS = [{ value: 'C', label: 'Crédito' }, { value: 'D', label: 'Débito' }, { value: 'A', label: 'Alimentação/Voucher' }];

/**
 * OPERADORAS (FRMCADOPERADORAS) — administradora/adquirente de cartão: taxa % (TXADM), dias de compensação e
 * override de taxa POR EMPRESA (operadoras_taxa). Alimenta o líquido/vencimento dos recebíveis (get_cartao).
 */
export function OperadorasPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<Operadora[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sel, setSel] = useState<OperadoraDetalhe | null>(null);
  const [form, setForm] = useState<Partial<OperadoraDetalhe>>({});
  const [taxas, setTaxas] = useState<OperadoraTaxa[]>([]);
  const [tEmp, setTEmp] = useState<number | undefined>();
  const [tTx, setTTx] = useState<number | undefined>();
  const [tDia, setTDia] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try { setLista(await listarOperadoras()); } catch (e) { mensagem.erro(e); } finally { setCarregando(false); }
  }, [mensagem]);
  useEffect(() => { void carregar(); }, [carregar]);

  const novo = () => { setSel({ codoperadoras: 0, operadora: '', itens: [] }); setForm({ tipo: 'C', ativo: 'S' }); setTaxas([]); };
  const abrir = async (id: number) => {
    try {
      const d = await obterOperadora(id);
      setSel(d); setForm(d); setTaxas((d.itens ?? []).map((t) => ({ ...t, idempresa: Number(t.idempresa) })));
    } catch (e) { mensagem.erro(e); }
  };

  const addTaxa = () => {
    if (!tEmp) { window.alert('Informe a empresa do override.'); return; }
    setTaxas((xs) => [...xs.filter((x) => x.idempresa !== tEmp), { idempresa: tEmp, txadm: tTx, diafechamento: tDia }]);
    setTEmp(undefined); setTTx(undefined); setTDia(undefined);
  };
  const rmTaxa = (emp: number) => setTaxas((xs) => xs.filter((x) => x.idempresa !== emp));

  const salvar = async () => {
    if (busy) return;
    if (!form.operadora) { window.alert('Informe o nome da operadora.'); return; }
    setBusy(true);
    try {
      const body: Partial<OperadoraDetalhe> = { ...form, itens: taxas };
      if (sel && sel.codoperadoras > 0) await atualizarOperadora(sel.codoperadoras, body);
      else await criarOperadora(body);
      mensagem.sucesso('Operadora salva.');
      setSel(null); await carregar();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  const excluir = async () => {
    if (!sel || sel.codoperadoras <= 0 || busy) return;
    if (!window.confirm(`Excluir a operadora ${sel.operadora}?`)) return;
    setBusy(true);
    try { await excluirOperadora(sel.codoperadoras); mensagem.sucesso('Operadora excluída.'); setSel(null); await carregar(); } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const set = (k: keyof OperadoraDetalhe, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  if (sel) {
    return (
      <div className="flex flex-col gap-gp-md p-pad-md">
        <PageHeader title={sel.codoperadoras > 0 ? `Operadora nº ${sel.codoperadoras}` : 'Nova operadora'} />
        <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="w-64"><Field label="&Nome da operadora" value={form.operadora ?? ''} onChange={(e) => set('operadora', e.target.value)} /></div>
          <div className="w-36"><SelectField label="&Tipo" value={form.tipo ?? 'C'} onChange={(v) => set('tipo', v)} options={TIPOS} /></div>
          <div className="w-28"><NumberField label="Taxa &adm (%)" value={form.txadm} decimais={4} min={0} onChange={(v) => set('txadm', v)} /></div>
          <div className="w-28"><NumberField label="Taxa &parc (%)" value={form.txadmparc} decimais={4} min={0} onChange={(v) => set('txadmparc', v)} /></div>
          <div className="w-32"><NumberField label="&Dias compens." value={form.diascomp} decimais={0} min={0} onChange={(v) => set('diascomp', v)} /></div>
          <Button label="&Salvar" variant="soft" disabled={busy} onClick={() => void salvar()} />
          {sel.codoperadoras > 0 && <Button label="E&xcluir" variant="ghost" disabled={busy} onClick={() => void excluir()} />}
          <Button label="&Voltar" variant="ghost" onClick={() => { setSel(null); void carregar(); }} />
        </div>

        <div className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="mb-2 text-body-sm font-semibold text-fg-muted">Override de taxa por empresa (opcional — tem precedência sobre a taxa base)</div>
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-28"><NumberField label="&Empresa" value={tEmp} decimais={0} min={1} onChange={setTEmp} /></div>
            <div className="w-28"><NumberField label="&Taxa (%)" value={tTx} decimais={4} min={0} onChange={setTTx} /></div>
            <div className="w-32"><NumberField label="&Dias fech." value={tDia} decimais={0} min={0} onChange={setTDia} /></div>
            <Button label="&Adicionar" variant="soft" onClick={addTaxa} />
          </div>
          <table className="mt-3 w-full text-body-sm">
            <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs">Empresa</th><th className="p-pad-xs text-right">Taxa %</th><th className="p-pad-xs text-right">Dias fech.</th><th className="p-pad-xs" /></tr></thead>
            <tbody>
              {taxas.map((t) => (
                <tr key={t.idempresa} className="border-t border-border">
                  <td className="p-pad-xs tabular-nums">{t.idempresa}</td>
                  <td className="p-pad-xs text-right tabular-nums">{Number(t.txadm ?? 0).toFixed(4)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{t.diafechamento ?? '—'}</td>
                  <td className="p-pad-xs text-right"><Button label="Remover" variant="ghost" onClick={() => rmTaxa(t.idempresa)} /></td>
                </tr>
              ))}
              {!taxas.length && <tr><td colSpan={4} className="p-pad-md text-fg-muted">Sem override — usa a taxa base para todas as empresas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const colunas: DataTableColumnDef<Operadora>[] = [
    { field: 'codoperadoras', headerName: 'Nº', type: 'text', width: 80, isPrimary: true },
    { field: 'operadora', headerName: 'Operadora', type: 'text' },
    { field: 'tipo', headerName: 'Tipo', type: 'text', width: 130, valueFormatter: (v: unknown) => (TIPOS.find((t) => t.value === v)?.label ?? '—') },
    { field: 'txadm', headerName: 'Taxa %', type: 'number', width: 110 },
    { field: 'diascomp', headerName: 'Dias comp.', type: 'number', width: 110 },
    { field: 'acoes', headerName: '', type: 'actions', width: 110, getActions: () => [{ id: 'abrir', label: 'Abrir', onClick: (row: Operadora) => void abrir(Number(row.codoperadoras)) }] },
  ];
  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Operadoras de cartão" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <Button label="&Nova operadora" variant="soft" onClick={novo} />
        <small className="text-fg-muted">Administradora/adquirente + taxa % e dias de compensação (base do líquido e vencimento dos recebíveis).</small>
      </div>
      <DataTable columns={colunas} rows={lista} loading={carregando} />
    </div>
  );
}
