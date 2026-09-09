import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirPagina } from '../../shared/print/imprimirPagina';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Linha { venc: string; razao: string | null; tipodoc: string; documento: string | null; valor: number; tipo: number; banco: string | null }
interface Resultado {
  linhas: Linha[];
  porTipo: Array<{ tipo: number; tipodoc: string; itens: number; valor: number }>;
  porDia: Array<{ venc: string; entradas: number; saidas: number; saldo: number }>;
  total: { entradas: number; saidas: number; saldo: number };
}

/**
 * SALDO DA EMPRESA (`FRMSALDOEMPRESA`). Dossiê: `uSaldoEmpresa.md`.
 *
 * O fluxo de caixa projetado: o que entra e o que sai, dia a dia, no período. A tela do legado tem quatro
 * visões do mesmo dado (por tipo, por dia, por fornecedor, agrupado por semana); esta abre com **o resumo por
 * tipo e o dia a dia**, que é o que responde "quanto sobra" — e a lista completa embaixo.
 *
 * Duas contas que vêm do legado e não são óbvias: **a pagar** é `(valor + vendor − desconto)`, e **o cartão é
 * projetado** — cai na data da venda mais os dias de compensação da operadora, já líquido da taxa.
 */
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const em30 = () => new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

export function SaldoEmpresaPage() {
  const mensagem = useMensagem();
  const [dataIni, setDataIni] = useState(hoje());
  const [dataFim, setDataFim] = useState(em30());
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const consultar = async () => {
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/cobranca/saldo-empresa?dataIni=${dataIni}&dataFim=${dataFim}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const imprimir = () => {
    if (!res) return;
    const win = window.open('', '_blank', 'width=1024,height=768');
    if (!win) { mensagem.erro('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
    const raiz = document.getElementById('saldo-impressao');
    if (!raiz) { win.close(); return; }
    imprimirPagina(win, raiz, `Saldo da empresa — ${data(dataIni)} a ${data(dataFim)}`);
  };

  const cols = useMemo<DataTableColumnDef<Linha>[]>(() => [
    { field: 'venc', headerName: 'Vencimento', type: 'text', width: 120, isPrimary: true, valueGetter: (l) => data(l.venc) },
    { field: 'tipodoc', headerName: 'Origem', type: 'text', width: 150 },
    { field: 'razao', headerName: 'Cliente / Fornecedor', type: 'text' },
    { field: 'documento', headerName: 'Documento', type: 'text', width: 130 },
    { field: 'banco', headerName: 'Banco', type: 'text', width: 160 },
    { field: 'valor', headerName: 'Valor', type: 'text', width: 140, valueGetter: (l) => moeda(l.valor) },
  ], []);

  const diaCols = useMemo<DataTableColumnDef<{ venc: string; entradas: number; saidas: number; saldo: number }>[]>(() => [
    { field: 'venc', headerName: 'Dia', type: 'text', width: 120, isPrimary: true, valueGetter: (d) => data(d.venc) },
    { field: 'entradas', headerName: 'Entra', type: 'text', width: 150, valueGetter: (d) => moeda(d.entradas) },
    { field: 'saidas', headerName: 'Sai', type: 'text', width: 150, valueGetter: (d) => moeda(d.saidas) },
    { field: 'saldo', headerName: 'Saldo do dia', type: 'text', width: 150, valueGetter: (d) => moeda(d.saldo) },
  ], []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Saldo da empresa" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="Vencimento &de" type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} /></div>
          <div className="w-40"><Field label="&até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></div>
          <Button label="&Consultar" disabled={ocupado} onClick={() => void consultar()} />
          <Button label="&Imprimir" variant="soft" disabled={!res} onClick={imprimir} />
        </div>
        <p className="mt-form-gap text-body-sm text-fg-muted">
          O que entra e o que sai no período, por data de vencimento. O cartão entra projetado — na data em que
          a operadora compensa, já líquido da taxa.
        </p>
      </section>

      {res && (
        <div id="saldo-impressao" className="flex flex-col gap-gp-md">
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Entra</div><div className="text-body-lg tabular-nums">{moeda(res.total.entradas)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Sai</div><div className="text-body-lg tabular-nums">{moeda(res.total.saidas)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Saldo do período</div><div className="text-body-lg tabular-nums">{moeda(res.total.saldo)}</div></div>
            </div>
            <div className="mt-form-gap flex flex-wrap gap-gp-lg border-t border-border pt-form-gap">
              {res.porTipo.map((t) => (
                <div key={t.tipo}>
                  <div className="text-body-sm text-fg-muted">{t.tipodoc} · {t.itens}</div>
                  <div className="tabular-nums">{moeda(t.valor)}</div>
                </div>
              ))}
            </div>
          </section>

          <h2 className="text-body-lg">Dia a dia</h2>
          <DataTable rows={res.porDia} columns={diaCols} getRowId={(d: { venc: string }) => d.venc} />

          <h2 className="text-body-lg">Documentos ({res.linhas.length.toLocaleString('pt-BR')})</h2>
          <DataTable rows={res.linhas} columns={cols} getRowId={(_l: Linha, i?: number) => String(i)} />
        </div>
      )}
    </div>
  );
}
