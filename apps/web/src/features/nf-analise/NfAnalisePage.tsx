import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import type { AnaliseNfDto } from '@apollo/shared';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirPagina } from '../../shared/print/imprimirPagina';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Resultado {
  modelo: string;
  linhas: Array<Record<string, unknown>>;
  totais: { notas: number; totalnf: number; totalprod: number; totalisento: number; divergencia: number };
  truncado: boolean;
}

/**
 * ANÁLISE DE NOTAS FISCAIS (`FRMNFANALISE`). Dossiê: `uNFAnalise.md`.
 *
 * A tela do legado é um radio de nove análises com um painel de filtros. Aqui estão as duas do corte-1, e as
 * outras sete aparecem na lista **desabilitadas, dizendo o que falta** — o operador vê o que ainda não veio
 * em vez de procurar um botão que não existe.
 *
 * O que dá valor à tela é o **"somente diferenças"**: a nota cujo rateio contábil não fecha com o total. No
 * cliente são 3.037 das 49.282 (6,2%), e cada uma é um lançamento que vai sair errado.
 */
const MODELOS = [
  { id: 'TRIBUTARIA', n: 1, label: 'Análise de situação tributária', ok: true },
  { id: 'CONFERENCIA', n: 8, label: 'Análise de conferência de notas', ok: true },
  { id: 'x2', n: 2, label: 'Análise de precificação', nota: 'depende do departamento e do agrupamento por fornecedor' },
  { id: 'x3', n: 3, label: 'Situação tributária por produtos', nota: 'próximo corte' },
  { id: 'x4', n: 4, label: 'Precificação agrupada por fornecedor', nota: 'depende da análise de precificação' },
  { id: 'x5', n: 5, label: 'Precificação agrupada por fornecedor — itens', nota: 'depende da análise de precificação' },
  { id: 'x6', n: 6, label: 'Análise de formas de pagamento', nota: 'próximo corte' },
  { id: 'x7', n: 7, label: 'Situação tributária por CST', nota: 'próximo corte' },
  { id: 'x9', n: 9, label: 'Conferência de ICMS-ST a recolher', nota: 'demonstrativo de 24 colunas sobre notas não cadastradas' },
];

const moeda = (v: unknown) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const data = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

export function NfAnalisePage() {
  const mensagem = useMensagem();
  const [modelo, setModelo] = useState<'TRIBUTARIA' | 'CONFERENCIA'>('TRIBUTARIA');
  const [f, setF] = useState({
    dataIni: inicioMes(), dataFim: hoje(), tipo: 'T' as 'T' | 'E' | 'S',
    nronf: '', razao: '', cfop: '', processadas: 'T' as 'S' | 'N' | 'T',
    incluirDevolucao: false, somenteDiferencas: false,
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const body: AnaliseNfDto = {
        modelo, dataIni: f.dataIni, dataFim: f.dataFim, tipo: f.tipo,
        nronf: f.nronf || null, razao: f.razao || null, cfop: f.cfop ? Number(f.cfop) : null,
        processadas: f.processadas, incluirDevolucao: f.incluirDevolucao, somenteDiferencas: f.somenteDiferencas,
      };
      const r = await fetch(`${BASE}/fiscal/nf-analise`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      const j = (await r.json()) as Resultado;
      setRes(j);
      if (j.truncado) mensagem.sucesso(`Análise gerada. Só as primeiras ${j.linhas.length.toLocaleString('pt-BR')} notas foram trazidas — reduza o período.`);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const imprimir = () => {
    if (!res) return;
    const win = window.open('', '_blank', 'width=1024,height=768');
    if (!win) { mensagem.erro('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
    const raiz = document.getElementById('nfa-impressao');
    if (!raiz) { win.close(); return; }
    const titulo = MODELOS.find((m) => m.id === modelo)?.label ?? 'Análise de notas';
    imprimirPagina(win, raiz, `${titulo} — ${data(f.dataIni)} a ${data(f.dataFim)}`, undefined, true);
  };

  const cols = useMemo<DataTableColumnDef<Record<string, unknown>>[]>(() => {
    const base: DataTableColumnDef<Record<string, unknown>>[] = [
      { field: 'nronf', headerName: 'Nº NF', type: 'text', width: 110, isPrimary: true },
      { field: 'dtcontabil', headerName: 'Contábil', type: 'text', width: 110, valueGetter: (l) => data(l.dtcontabil) },
      { field: 'tipo', headerName: 'Tipo', type: 'text', width: 70, valueGetter: (l) => (l.tipo === 'E' ? 'Entrada' : 'Saída') },
      { field: 'razao', headerName: 'Cliente / Fornecedor', type: 'text' },
      { field: 'cfop', headerName: 'CFOP', type: 'text', width: 90 },
      { field: 'totalnf', headerName: 'Total da nota', type: 'text', width: 130, valueGetter: (l) => moeda(l.totalnf) },
    ];
    if (modelo === 'TRIBUTARIA') {
      base.push(
        { field: 'totalisento', headerName: 'Isento', type: 'text', width: 120, valueGetter: (l) => moeda(l.totalisento) },
        { field: 'rateio_contabil', headerName: 'Rateio contábil', type: 'text', width: 140, valueGetter: (l) => moeda(l.rateio_contabil) },
        { field: 'diferenca', headerName: 'Diferença', type: 'text', width: 130,
          valueGetter: (l) => (Math.abs(Number(l.diferenca ?? 0)) < 0.005 ? '—' : moeda(l.diferenca)) },
      );
    } else {
      base.push(
        { field: 'alterado_por', headerName: 'Alterada por', type: 'text', width: 180 },
        { field: 'alterado_em', headerName: 'Quando', type: 'text', width: 150 },
      );
    }
    return base;
  }, [modelo]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Análise de notas fiscais" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="grid grid-cols-1 gap-gp-sm sm:grid-cols-2">
          {MODELOS.map((m) => (
            <label key={m.id} className={`flex cursor-pointer items-start gap-gp-sm rounded-radius-md border p-pad-sm ${modelo === m.id ? 'border-fg-accent bg-bg-subtle' : 'border-border'} ${m.ok ? '' : 'opacity-60'}`}>
              <input type="radio" name="modelo" className="mt-1" checked={modelo === m.id} disabled={!m.ok}
                onChange={() => m.ok && setModelo(m.id as 'TRIBUTARIA' | 'CONFERENCIA')} />
              <span>
                <span className="block text-body-md">{m.n} — {m.label}</span>
                {m.nota && <span className="block text-body-sm text-fg-muted">{m.nota}</span>}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="Contábil &de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-36"><SelectField label="&Tipo" options={[{ value: 'T', label: 'Todas' }, { value: 'E', label: 'Entrada' }, { value: 'S', label: 'Saída' }]}
            value={f.tipo} onChange={(v) => setF({ ...f, tipo: (v ?? 'T') as 'T' })} /></div>
          <div className="w-36"><Field label="&Nº NF" value={f.nronf} onChange={(e) => setF({ ...f, nronf: e.target.value })} /></div>
          <div className="w-56"><Field label="&Cliente / fornecedor" value={f.razao} onChange={(e) => setF({ ...f, razao: e.target.value })} placeholder="parte da razão social" /></div>
          <div className="w-28"><Field label="C&FOP" value={f.cfop} onChange={(e) => setF({ ...f, cfop: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="w-44"><SelectField label="&Processadas" options={[{ value: 'T', label: 'Todas' }, { value: 'S', label: 'Só processadas' }, { value: 'N', label: 'Só não processadas' }]}
            value={f.processadas} onChange={(v) => setF({ ...f, processadas: (v ?? 'T') as 'T' })} /></div>
        </div>
        <div className="mt-form-gap flex flex-wrap items-center gap-gp-md">
          <label className="flex items-center gap-gp-sm text-body-sm">
            <input type="checkbox" checked={f.incluirDevolucao} onChange={(e) => setF({ ...f, incluirDevolucao: e.target.checked })} />
            Incluir notas de devolução
          </label>
          {modelo === 'TRIBUTARIA' && (
            <label className="flex items-center gap-gp-sm text-body-sm">
              <input type="checkbox" checked={f.somenteDiferencas} onChange={(e) => setF({ ...f, somenteDiferencas: e.target.checked })} />
              Somente diferenças <span className="text-fg-muted">(o rateio contábil não fecha com o total)</span>
            </label>
          )}
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={!res} onClick={imprimir} />
        </div>
      </section>

      {res && (
        <div id="nfa-impressao" className="flex flex-col gap-gp-md">
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Notas</div><div className="text-body-lg tabular-nums">{res.totais.notas.toLocaleString('pt-BR')}{res.truncado && ' +'}</div></div>
              <div><div className="text-body-sm text-fg-muted">Total das notas</div><div className="text-body-lg tabular-nums">{moeda(res.totais.totalnf)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Isento</div><div className="text-body-lg tabular-nums">{moeda(res.totais.totalisento)}</div></div>
              {modelo === 'TRIBUTARIA' && (
                <div><div className="text-body-sm text-fg-muted">Divergência do rateio</div><div className="text-body-lg tabular-nums">{moeda(res.totais.divergencia)}</div></div>
              )}
            </div>
          </section>
          <DataTable rows={res.linhas} columns={cols} getRowId={(l: Record<string, unknown>) => String(l.codnf)} />
        </div>
      )}
    </div>
  );
}
