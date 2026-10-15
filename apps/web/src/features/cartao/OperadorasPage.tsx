import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { Button } from '../../shared/ui/Button';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { LookupField } from '../../shared/ui/LookupField';
import { useMensagem } from '../../shared/mensagem';
import { getSessao } from '../../shared/auth/session';
import {
  listarOperadoras, obterOperadora, criarOperadora, atualizarOperadora, excluirOperadora, listarFilhasOperadora,
  type Operadora, type OperadoraDetalhe, type OperadoraTaxa,
} from './cartaoApi';

// o combo TIPO do UcadOperadoras.dfm (valor → rótulo)
const TIPOS = [{ value: 'A', label: 'ALIMENTACAO' }, { value: 'C', label: 'CREDITO' }, { value: 'D', label: 'DEBITO' }, { value: 'G', label: 'GIFT' },
  { value: 'O', label: 'OUTRO' }, { value: 'P', label: 'PREMIUM' }, { value: 'R', label: 'REFEICAO' }];
// o TIPOCARTAO do grupo TEF (UcadOperadoras.dfm)
const TIPOS_CARTAO = [{ value: '0', label: '0 - Cheque' }, { value: '1', label: '1 - Cartão de Débito' }, { value: '2', label: '2 - Cartão de Crédito' },
  { value: '3', label: '3 - Cartão Tipo Voucher' }, { value: '5', label: '5 - Cartão Fidelidade' }, { value: '98', label: '98 - Dinheiro' }, { value: '99', label: '99 - Outros Tipo de Cartão' }];
const sel2 = 'w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm';

/**
 * OPERADORAS (FRMCADOPERADORAS, UcadOperadoras.pas/.dfm) — a operadora de cartão com todos os campos do legado: compensação, taxas
 * (administrativa, parcelado, gestão, anuidade), dia de fechamento, banco, parceiro (administradora), empresas, observações, desabilitado,
 * o grupo TEF (operadora do PDV, tipo do cartão, rede, bandeira, operadora base, POS, validar NSU) e a aba Taxas por loja (OPERADORAS_TAXA
 * com gestão, anuidade e antecipação) e a aba Operadoras Assossiadas (as que têm esta como base). Alimenta o líquido/vencimento dos
 * recebíveis (get_cartao).
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
  const [tGest, setTGest] = useState<number | undefined>();
  const [tAnu, setTAnu] = useState<number | undefined>();
  const [tAnt, setTAnt] = useState<number | undefined>();
  // a empresa da taxa em edição (o "Editar" do btnCancelarTaxaEmpresa)
  const [editando, setEditando] = useState<number | null>(null);
  const [filhas, setFilhas] = useState<Array<Record<string, unknown>>>([]);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try { setLista(await listarOperadoras()); } catch (e) { mensagem.erro(e); } finally { setCarregando(false); }
  }, [mensagem]);
  useEffect(() => { void carregar(); }, [carregar]);

  const novo = () => {
    setSel({ codoperadoras: 0, operadora: '', itens: [] });
    setForm({ tipo: 'C', ativo: 'S', empresas: String(getSessao()?.empresa ?? '') || null });
    setTaxas([]); setFilhas([]); setEditando(null);
  };
  const abrir = async (id: number) => {
    try {
      const d = await obterOperadora(id);
      setSel(d); setForm(d); setTaxas((d.itens ?? []).map((t) => ({ ...t, idempresa: Number(t.idempresa) }))); setEditando(null);
      setFilhas(await listarFilhasOperadora(id));
    } catch (e) { mensagem.erro(e); }
  };

  const limparTaxa = () => { setTEmp(undefined); setTTx(undefined); setTDia(undefined); setTGest(undefined); setTAnu(undefined); setTAnt(undefined); setEditando(null); };
  // o btnSalvarTaxaEmpresaClick: sem empresa não grava; a empresa que já tem taxa não entra de novo. No legado o dicionário contém a
  // própria empresa da linha em edição e o "Editar" sempre esbarrava nessa mensagem — aqui a linha em edição se substitui.
  const addTaxa = () => {
    if (!tEmp) { window.alert('Selecione uma empresa antes de gravar uma taxa.'); return; }
    if (tEmp !== editando && taxas.some((x) => x.idempresa === tEmp)) { window.alert('Empresa já cadastrada para essa operadora.'); return; }
    setTaxas((xs) => [...xs.filter((x) => x.idempresa !== tEmp && x.idempresa !== editando), { idempresa: tEmp, txadm: tTx, diafechamento: tDia, txgestao: tGest, txanuidade: tAnu, txantecipacao: tAnt }]);
    limparTaxa();
  };
  const editarTaxa = (t: OperadoraTaxa) => {
    setEditando(t.idempresa); setTEmp(t.idempresa); setTTx(t.txadm ?? undefined); setTDia(t.diafechamento ?? undefined);
    setTGest(t.txgestao ?? undefined); setTAnu(t.txanuidade ?? undefined); setTAnt(t.txantecipacao ?? undefined);
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
        {/* a aba "Operadoras" do UcadOperadoras.dfm */}
        <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-64"><Field label="Nome da Operadora" value={form.operadora ?? ''} maxLength={50} onChange={(e) => set('operadora', e.target.value)}
              // o edtOperadoraExit: a Operadora PDV vazia herda o nome
              onBlur={() => { if (!(form.operadora_pdv ?? '').trim() && form.operadora) set('operadora_pdv', form.operadora); }} /></div>
            <div className="w-32"><NumberField label="Dias para Compensação" value={form.diascomp ?? undefined} decimais={0} min={0} onChange={(v) => set('diascomp', v)} /></div>
            <div className="w-32"><NumberField label="Taxa Administrativa" value={form.txadm ?? undefined} decimais={4} min={0} onChange={(v) => set('txadm', v)} /></div>
            <div className="w-32"><NumberField label="Taxa parcelado" value={form.txadmparc ?? undefined} decimais={4} min={0} onChange={(v) => set('txadmparc', v)} /></div>
            <div className="w-40">
              <label className="mb-1 block text-body-sm text-fg-muted" htmlFor="op-tipo">Tipo</label>
              <select id="op-tipo" className={sel2} value={form.tipo ?? ''} onChange={(e) => set('tipo', e.target.value || null)}>
                <option value="" />
                {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                {form.tipo && !TIPOS.some((t) => t.value === form.tipo) && <option value={form.tipo}>{form.tipo}</option>}
              </select>
            </div>
            <div className="w-32"><NumberField label="Taxa de Gestão" value={form.txgestao ?? undefined} decimais={3} min={0} onChange={(v) => set('txgestao', v)} /></div>
            <div className="w-32"><NumberField label="Taxa de Anuidade" value={form.txanuidade ?? undefined} decimais={3} min={0} onChange={(v) => set('txanuidade', v)} /></div>
            <div className="w-28"><Field label="Dia Fechamento" value={form.diafechamento ?? ''} maxLength={5} onChange={(e) => set('diafechamento', e.target.value || null)} /></div>
          </div>
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-72"><LookupField label="Banco" recurso="lookup/bancos" campoCodigo="codigo" descricao="banco" value={form.codbanco ?? null} onChange={(c) => set('codbanco', c ? Number(c) : null)} /></div>
            <div className="w-72"><LookupField label="Parceiro" recurso="lookup/parceiros" campoCodigo="codparceiro" descricao="razao" fixos={{ frn: 'S' }} value={form.codadm ?? null} onChange={(c) => set('codadm', c ? Number(c) : null)} /></div>
            <div className="w-48"><Field label="Empresas" value={form.empresas ?? ''} maxLength={300} onChange={(e) => set('empresas', e.target.value || null)} /></div>
            <CheckboxField label="Desabilitado" value={form.ativo === 'N' ? 'S' : 'N'} onChange={(v) => set('ativo', v === 'S' ? 'N' : 'S')} />
          </div>
          <div className="w-full"><Field label="Observações" value={form.obs ?? ''} maxLength={1000} onChange={(e) => set('obs', e.target.value || null)} /></div>
          {/* o grupo TEF */}
          <fieldset className="flex flex-wrap items-end gap-gp-sm rounded-radius-sm border border-border p-pad-sm">
            <legend className="px-1 text-body-sm text-fg-muted">TEF</legend>
            <div className="w-56"><Field label="Operadora PDV" value={form.operadora_pdv ?? ''} maxLength={50} onChange={(e) => set('operadora_pdv', e.target.value || null)} /></div>
            <div className="w-56">
              <label className="mb-1 block text-body-sm text-fg-muted" htmlFor="op-tipocartao">Tipo do cartão</label>
              <select id="op-tipocartao" className={sel2} value={form.tipocartao != null ? String(form.tipocartao) : ''} onChange={(e) => set('tipocartao', e.target.value === '' ? null : Number(e.target.value))}>
                <option value="" />
                {TIPOS_CARTAO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="w-64"><LookupField label="Rede" recurso="lookup/rede" campoCodigo="codigo" descricao="descricao" value={form.codrede ?? null} onChange={(c) => set('codrede', c ? Number(c) : null)} /></div>
            <div className="w-28"><NumberField label="Bandeira" value={form.codbandeira ?? undefined} decimais={0} min={0} onChange={(v) => set('codbandeira', v ?? null)} /></div>
            <div className="w-72"><LookupField label="Operadora Base" recurso="lookup/operadoras" campoCodigo="codoperadoras" descricao="operadora" value={form.codoperadorabase ?? null} onChange={(c) => set('codoperadorabase', c ? Number(c) : null)} /></div>
            <CheckboxField label="POS" value={form.pos === 'S' ? 'S' : 'N'} onChange={(v) => set('pos', v)} />
            <CheckboxField label="Validar NSU" value={form.flg_validar_nsu === 'S' ? 'S' : 'N'} onChange={(v) => set('flg_validar_nsu', v)} />
          </fieldset>
          <div className="flex gap-gp-sm">
            <Button label="Salvar" variant="soft" disabled={busy} onClick={() => void salvar()} />
            {sel.codoperadoras > 0 && <Button label="Excluir" variant="ghost" disabled={busy} onClick={() => void excluir()} />}
            <Button label="&Voltar" variant="ghost" onClick={() => { setSel(null); void carregar(); }} />
          </div>
        </div>

        {/* a aba "Taxas" (OPERADORAS_TAXA): por loja, dia de fechamento, taxa administrativa, de gestão, de anuidade e de antecipação */}
        <div className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="mb-2 text-body-sm font-semibold text-fg-muted">Taxas por empresa (têm precedência sobre as da operadora)</div>
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-24"><NumberField label="Empresa" value={tEmp} decimais={0} min={1} onChange={setTEmp} /></div>
            <div className="w-28"><NumberField label="Dia Fechamento" value={tDia} decimais={0} min={0} onChange={setTDia} /></div>
            <div className="w-28"><NumberField label="Taxa Administrativa" value={tTx} decimais={4} min={0} onChange={setTTx} /></div>
            <div className="w-28"><NumberField label="Taxa de Gestão" value={tGest} decimais={3} min={0} onChange={setTGest} /></div>
            <div className="w-28"><NumberField label="Taxa de Anuidade" value={tAnu} decimais={3} min={0} onChange={setTAnu} /></div>
            <div className="w-28"><NumberField label="Taxa Antecipação" value={tAnt} decimais={2} min={0} onChange={setTAnt} /></div>
            <Button label={editando != null ? 'Salvar' : 'Inserir'} variant="soft" onClick={addTaxa} />
            {editando != null && <Button label="Cancelar" variant="ghost" onClick={limparTaxa} />}
          </div>
          <table className="mt-3 w-full text-body-sm" aria-label="Taxas por empresa">
            <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs">Empresa</th><th className="p-pad-xs text-right">Dia fech.</th><th className="p-pad-xs text-right">Taxa adm.</th><th className="p-pad-xs text-right">Gestão</th><th className="p-pad-xs text-right">Anuidade</th><th className="p-pad-xs text-right">Antecipação</th><th className="p-pad-xs" /></tr></thead>
            <tbody>
              {taxas.map((t) => (
                <tr key={t.idempresa} className="border-t border-border">
                  <td className="p-pad-xs tabular-nums">{t.idempresa}</td>
                  <td className="p-pad-xs text-right tabular-nums">{t.diafechamento ?? ''}</td>
                  <td className="p-pad-xs text-right tabular-nums">{t.txadm != null ? Number(t.txadm).toFixed(4) : ''}</td>
                  <td className="p-pad-xs text-right tabular-nums">{t.txgestao != null ? Number(t.txgestao).toFixed(3) : ''}</td>
                  <td className="p-pad-xs text-right tabular-nums">{t.txanuidade != null ? Number(t.txanuidade).toFixed(3) : ''}</td>
                  <td className="p-pad-xs text-right tabular-nums">{t.txantecipacao != null ? Number(t.txantecipacao).toFixed(2) : ''}</td>
                  <td className="p-pad-xs text-right"><Button label="Editar" variant="ghost" onClick={() => editarTaxa(t)} /><Button label="Excluir" variant="ghost" onClick={() => rmTaxa(t.idempresa)} /></td>
                </tr>
              ))}
              {!taxas.length && <tr><td colSpan={7} className="p-pad-md text-fg-muted">Sem taxas por empresa — valem as da operadora.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* a aba "Operadoras Assossiadas" (tbOperadorasAssossiadas): as operadoras que têm esta como OPERADORA BASE, com as colunas da grade */}
        {sel.codoperadoras > 0 && (
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="mb-2 text-body-sm font-semibold text-fg-muted">Operadoras Assossiadas</div>
            <table className="w-full text-body-sm" aria-label="Operadoras Assossiadas">
              <thead><tr className="text-left text-fg-muted">
                {['Código', 'Operadora', 'Operadora PDV', 'Dias comp.', 'Taxa adm.', 'Parceiro', 'Gestão', 'Anuidade', 'Tipo', 'Dia fech.', 'Banco', 'Obs', 'Empresas', 'Ativo', 'POS', 'Tipo cartão', 'Rede', 'Bandeira']
                  .map((h) => <th key={h} className="p-pad-xs">{h}</th>)}
              </tr></thead>
              <tbody>
                {filhas.map((f) => (
                  <tr key={String(f.codoperadoras)} className="border-t border-border">
                    {['codoperadoras', 'operadora', 'operadora_pdv', 'diascomp', 'txadm', 'codadm', 'txgestao', 'txanuidade', 'tipo', 'diafechamento', 'codbanco', 'obs', 'empresas', 'ativo', 'pos', 'tipocartao', 'codrede', 'codbandeira']
                      .map((c) => <td key={c} className="p-pad-xs tabular-nums">{c === 'tipo' ? (TIPOS.find((t) => t.value === f[c])?.label ?? String(f[c] ?? '')) : String(f[c] ?? '')}</td>)}
                  </tr>
                ))}
                {!filhas.length && <tr><td colSpan={18} className="p-pad-md text-fg-muted">Nenhuma operadora tem esta como base.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
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
      <DataTable columns={colunas} rows={lista} loading={carregando} getRowId={(r: any) => Number(r.codoperadoras)} />
    </div>
  );
}
