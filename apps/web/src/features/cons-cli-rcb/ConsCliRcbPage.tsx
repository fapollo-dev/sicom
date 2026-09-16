import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { gradeLayoutService } from '../../shared/grade/savedViewsService';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Titulo {
  codigo: number; duplicata: string; dtvenda: string; dtvenc: string;
  valor: number; txjuros: number; atraso: number; tolerancia: number;
  juro: number; total: number; quitada: string; nrocupom: string | null; obs: string | null;
  cliente: string | null;
}
interface Resultado {
  titulos: Titulo[];
  totais: { titulos: number; principal: number; juro: number; total: number; vencidos: number };
}

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));

/**
 * CONSULTA A RECEBER POR CLIENTE (`FRMCONSCLIRCB`). Dossiê: `uConsCliRcb.md`.
 *
 * A tela que se abre quando o cliente liga perguntando quanto deve: títulos em aberto, atraso, juro e total
 * atualizado.
 *
 * O juro é a taxa **mensal do título** dividida por 30, sobre os dias de atraso. Título sem taxa não rende
 * juro — no sistema antigo, a coluna de juro mostrava 9% ao mês mesmo nesses casos, e o total não incluía.
 */
export function ConsCliRcbPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ codparceiro: '', somenteAbertos: true, tolerancia: '' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const consultar = async () => {
    if (!f.codparceiro) { mensagem.erro('Informe o cliente.'); return; }
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v !== '' && v !== false) q.set(k, String(v)); });
      const r = await fetch(`${BASE}/cobranca/cons-cli-rcb?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const cols = useMemo<DataTableColumnDef<Titulo>[]>(() => [
    { field: 'codigo', headerName: 'Título', type: 'text', width: 100, isPrimary: true },
    { field: 'duplicata', headerName: 'Duplicata', type: 'text', width: 150 },
    { field: 'dtvenc', headerName: 'Vencimento', type: 'text', width: 120, valueGetter: (t) => dataBr(t.dtvenc) },
    {
      // o número que abre a conversa com o cliente
      field: 'atraso', headerName: 'Atraso (dias)', type: 'text', width: 125, valueGetter: () => '',
      renderCell: ({ row: t }: { row: Titulo }) => {
        const a = Number(t.atraso);
        return <span className={a > 30 ? 'font-semibold text-fg-danger tabular-nums' : a > 0 ? 'text-fg-warning tabular-nums' : 'tabular-nums'}>{a}</span>;
      },
    } as DataTableColumnDef<Titulo>,
    { field: 'valor', headerName: 'Principal', type: 'text', width: 130, valueGetter: (t) => moeda(t.valor) },
    { field: 'txjuros', headerName: 'Taxa (% a.m.)', type: 'text', width: 125,
      valueGetter: (t) => (Number(t.txjuros) > 0 ? `${Number(t.txjuros).toLocaleString('pt-BR')}%` : '—') },
    { field: 'juro', headerName: 'Juro', type: 'text', width: 120, valueGetter: (t) => moeda(t.juro) },
    { field: 'total', headerName: 'Total atualizado', type: 'text', width: 155, valueGetter: (t) => moeda(t.total) },
    { field: 'quitada', headerName: 'Quitado', type: 'text', width: 95, valueGetter: (t) => (t.quitada === 'S' ? 'Sim' : 'Não') },
  ], []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="A receber por cliente" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&Cliente (código)" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value })} /></div>
          <div className="w-44"><Field label="&Tolerância (dias)" value={f.tolerancia} onChange={(e) => setF({ ...f, tolerancia: e.target.value })} placeholder="0" /></div>
          <label className="flex items-center gap-gp-sm text-body-sm">
            <input type="checkbox" checked={f.somenteAbertos} onChange={(e) => setF({ ...f, somenteAbertos: e.target.checked })} />
            Só os em aberto
          </label>
          <Button label="&Consultar" disabled={ocupado} onClick={() => void consultar()} />
          <Button label="E&xportar" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            exportarGradeCsv(res.titulos, [
              { titulo: 'Título', valor: (t) => t.codigo },
              { titulo: 'Duplicata', valor: (t) => t.duplicata },
              { titulo: 'Vencimento', valor: (t) => dataBr(t.dtvenc) },
              { titulo: 'Atraso (dias)', valor: (t) => t.atraso },
              { titulo: 'Principal', valor: (t) => t.valor },
              { titulo: 'Taxa (% a.m.)', valor: (t) => t.txjuros },
              { titulo: 'Juro', valor: (t) => t.juro },
              { titulo: 'Total atualizado', valor: (t) => t.total },
            ], 'a-receber-cliente');
          }} />
        </div>
        <p className="mt-form-gap text-body-sm text-fg-muted">
          A <strong>tolerância</strong> zera o juro enquanto o atraso não a ultrapassa — e, quando ultrapassa,
          o juro conta sobre <strong>todos</strong> os dias, não só os que passaram dela.
        </p>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div>
                <div className="text-body-sm text-fg-muted">Cliente</div>
                <div className="text-body-lg">{res.titulos[0]?.cliente ?? '—'}</div>
              </div>
              <div><div className="text-body-sm text-fg-muted">Títulos</div><div className="text-body-lg tabular-nums">{res.totais.titulos}</div></div>
              <div><div className="text-body-sm text-fg-muted">Vencidos</div><div className="text-body-lg tabular-nums text-fg-danger">{res.totais.vencidos}</div></div>
              <div><div className="text-body-sm text-fg-muted">Principal</div><div className="text-body-lg tabular-nums">{moeda(res.totais.principal)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Juro</div><div className="text-body-lg tabular-nums">{moeda(res.totais.juro)}</div></div>
              <div>
                <div className="text-body-sm text-fg-muted">Total atualizado</div>
                <div className="text-body-lg font-semibold tabular-nums">{moeda(res.totais.total)}</div>
              </div>
            </div>
          </section>
          <DataTable persistId="cons-cli-rcb" savedViewsService={gradeLayoutService}
            rows={res.titulos} columns={cols} getRowId={(t: Titulo) => String(t.codigo)} />
        </>
      )}
    </div>
  );
}
