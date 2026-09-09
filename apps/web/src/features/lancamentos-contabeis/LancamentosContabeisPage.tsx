import { useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { FileSearch } from 'lucide-react';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirPagina } from '../../shared/print/imprimirPagina';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Linha {
  coddiario: number; datalan: string; contadebito: number | null; contacredito: number | null;
  reduzido_debito: string | null; reduzido_credito: string | null;
  desc_debito: string | null; desc_credito: string | null;
  valor: number; documento: string | null; deschist: string | null; origem: string | null; codorigem: number;
}
interface Resultado {
  linhas: Linha[];
  totais: { linhas: number; debito: number; credito: number; diferenca: number };
  porOrigem: Array<{ codorigem: number; origem: string; linhas: number; valor: number }>;
  truncado: boolean;
}

/**
 * LANÇAMENTOS CONTÁBEIS (`FRMRELLANCAMENTOSCONTABEIS`). Dossiê: `uRelLancamentosContabeis.md`.
 *
 * O razão **por lançamento** — não confundir com o Livro Razão, que é por conta com saldo acumulado. Aqui o
 * que interessa é de ONDE veio cada linha: a origem aparece pelo nome, e o botão de cada linha abre o
 * documento que a gerou.
 *
 * Débito e crédito somam separado de propósito: parte das origens grava linha de um lado só.
 */
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

export function LancamentosContabeisPage() {
  const mensagem = useMensagem();
  const [origens, setOrigens] = useState<Array<{ codorigem: number; descorigem: string; lancamentos: number }>>([]);
  const [f, setF] = useState({ dataIni: inicioMes(), dataFim: hoje(), codorigem: '', conta: '', documento: '', somenteSingle: false });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    void fetch(`${BASE}/contabil/lancamentos/origens`, { headers: apiHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then(setOrigens)
      .catch(() => setOrigens([]));
  }, []);

  const gerar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim });
      if (f.codorigem) q.set('codorigem', f.codorigem);
      if (f.conta) q.set('conta', f.conta);
      if (f.documento) q.set('documento', f.documento);
      if (f.somenteSingle) q.set('somenteSingle', 'true');
      const r = await fetch(`${BASE}/contabil/lancamentos?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      const j = (await r.json()) as Resultado;
      setRes(j);
      if (j.truncado) mensagem.sucesso(`Só as primeiras ${j.linhas.length.toLocaleString('pt-BR')} linhas foram trazidas — reduza o período.`);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  /** o "Detalhar" do legado: do lançamento para o papel que o gerou. */
  const detalhar = async (l: Linha) => {
    try {
      const r = await fetch(`${BASE}/contabil/lancamentos/${l.coddiario}/origem`, { headers: apiHeaders() });
      handle401(r);
      const j = await r.json();
      if (j?.documento) {
        mensagem.sucesso(`${j.origem ?? 'Origem'} — ${j.tipo} nº ${j.documento}${j.rota ? `\n${j.rota}` : ''}`);
      } else {
        mensagem.sucesso(`${j.origem ?? `Origem ${l.codorigem}`} — este lançamento não tem documento navegável no Apollo ainda. Identificador de origem: ${j.idorigem ?? '—'}`);
      }
    } catch (e) { mensagem.erro(e); }
  };

  const cols = useMemo<DataTableColumnDef<Linha>[]>(() => [
    { field: 'datalan', headerName: 'Data', type: 'text', width: 105, isPrimary: true, valueGetter: (l) => data(l.datalan) },
    { field: 'origem', headerName: 'Origem', type: 'text', width: 240 },
    { field: 'deschist', headerName: 'Histórico', type: 'text' },
    { field: 'documento', headerName: 'Documento', type: 'text', width: 120 },
    { field: 'debito', headerName: 'Débito', type: 'text', width: 150,
      valueGetter: (l) => (l.contadebito == null ? '—' : `${l.reduzido_debito ?? l.contadebito} ${l.desc_debito ?? ''}`.trim()) },
    { field: 'credito', headerName: 'Crédito', type: 'text', width: 150,
      valueGetter: (l) => (l.contacredito == null ? '—' : `${l.reduzido_credito ?? l.contacredito} ${l.desc_credito ?? ''}`.trim()) },
    { field: 'valor', headerName: 'Valor', type: 'text', width: 130, valueGetter: (l) => moeda(l.valor) },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 60,
      getActions: ({ row: l }: { row: Linha }) => [
        { id: 'det', label: 'Ver a origem', icon: <FileSearch size={16} />, onClick: () => void detalhar(l) },
      ],
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Lançamentos contábeis" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-72">
            <SelectField label="&Origem" value={f.codorigem} onChange={(v) => setF({ ...f, codorigem: v ?? '' })}
              options={[{ value: '', label: 'Todas' }, ...origens.map((o) => ({ value: String(o.codorigem), label: `${o.descorigem} (${o.lancamentos})` }))]} />
          </div>
          <div className="w-32"><Field label="&Conta" value={f.conta} onChange={(e) => setF({ ...f, conta: e.target.value.replace(/\D/g, '') })} placeholder="débito ou crédito" /></div>
          <div className="w-40"><Field label="Do&cumento" value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            const win = window.open('', '_blank', 'width=1024,height=768');
            if (!win) { mensagem.erro('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
            const raiz = document.getElementById('lanc-impressao');
            if (!raiz) { win.close(); return; }
            imprimirPagina(win, raiz, `Lançamentos contábeis — ${data(f.dataIni)} a ${data(f.dataFim)}`, undefined, true);
          }} />
        </div>
        <label className="mt-form-gap flex items-center gap-gp-sm text-body-sm">
          <input type="checkbox" checked={f.somenteSingle} onChange={(e) => setF({ ...f, somenteSingle: e.target.checked })} />
          Só os lançamentos de um lado só <span className="text-fg-muted">(algumas origens gravam débito e crédito em linhas separadas)</span>
        </label>
      </section>

      {res && (
        <div id="lanc-impressao" className="flex flex-col gap-gp-md">
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Lançamentos</div><div className="text-body-lg tabular-nums">{res.totais.linhas.toLocaleString('pt-BR')}{res.truncado && ' +'}</div></div>
              <div><div className="text-body-sm text-fg-muted">Débito</div><div className="text-body-lg tabular-nums">{moeda(res.totais.debito)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Crédito</div><div className="text-body-lg tabular-nums">{moeda(res.totais.credito)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Diferença</div><div className="text-body-lg tabular-nums">{moeda(res.totais.diferenca)}</div></div>
            </div>
            {res.porOrigem.length > 1 && (
              <div className="mt-form-gap flex flex-wrap gap-gp-lg border-t border-border pt-form-gap">
                {res.porOrigem.slice(0, 8).map((o) => (
                  <div key={o.codorigem}>
                    <div className="text-body-sm text-fg-muted">{o.origem} · {o.linhas}</div>
                    <div className="tabular-nums">{moeda(o.valor)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <DataTable rows={res.linhas} columns={cols} getRowId={(l: Linha) => String(l.coddiario)} />
        </div>
      )}
    </div>
  );
}
