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

interface Dia { dtvenda: string; total_vendas: number; recebidas: number; nao_recebidas: number; lancamentos: number }
interface PorOperadora extends Dia { operadora: string; codoperadora: number }
interface Resultado { linhas: Dia[]; totais: { total: number; recebido: number; aReceber: number; dias: number } }

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

/**
 * FLUXO DE CARTÕES (`FRMFLUXOCARTOES`). Dossiê: `uFluxoCartoes.md`.
 *
 * Quanto a loja vendeu no cartão, **quanto já caiu na conta e quanto ainda vai cair**. Clicar num dia abre
 * o detalhe por operadora.
 *
 * O legado mostrava o mesmo dia em duas linhas (uma para o recebido, outra para o pendente) e chamava as
 * duas de "total". Aqui é uma linha por dia, e a soma fecha.
 */
export function FluxoCartoesPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: diaUm(), dataFim: hoje(), codoperadora: '' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [dia, setDia] = useState<{ data: string; linhas: PorOperadora[] } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const chamar = async (url: string) => {
    const r = await fetch(`${BASE}/${url}`, { headers: apiHeaders() });
    handle401(r);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
      throw Object.assign(new Error(env.code), { envelope: env });
    }
    return r.json();
  };

  const gerar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v !== '') q.set(k, String(v)); });
      setRes((await chamar(`cobranca/fluxo-cartoes?${q}`)) as Resultado);
      setDia(null);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const abrirDia = async (data: string) => {
    setOcupado(true);
    try {
      setDia({ data, linhas: (await chamar(`cobranca/fluxo-cartoes/dia?data=${data.slice(0, 10)}`)) as PorOperadora[] });
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const colsDia = useMemo<DataTableColumnDef<Dia>[]>(() => [
    { field: 'dtvenda', headerName: 'Dia', type: 'text', width: 110, isPrimary: true, valueGetter: (d) => dataBr(d.dtvenda) },
    { field: 'total_vendas', headerName: 'Vendido', type: 'text', width: 150, valueGetter: (d) => moeda(d.total_vendas) },
    {
      field: 'recebidas', headerName: 'Já recebido', type: 'text', width: 150, valueGetter: () => '',
      renderCell: ({ row: d }: { row: Dia }) => <span className="text-fg-success tabular-nums">{moeda(d.recebidas)}</span>,
    } as DataTableColumnDef<Dia>,
    {
      // o que ainda não caiu: é a leitura que o extrato bancário não dá
      field: 'nao_recebidas', headerName: 'A receber', type: 'text', width: 150, valueGetter: () => '',
      renderCell: ({ row: d }: { row: Dia }) => (
        Number(d.nao_recebidas) > 0
          ? <span className="font-semibold text-fg-warning tabular-nums">{moeda(d.nao_recebidas)}</span>
          : <span className="text-fg-muted">—</span>
      ),
    } as DataTableColumnDef<Dia>,
    { field: 'lancamentos', headerName: 'Lançamentos', type: 'text', width: 125 },
    {
      field: 'acoes', headerName: '', type: 'text', width: 110, valueGetter: () => '',
      renderCell: ({ row: d }: { row: Dia }) => (
        <Button label="Operadoras" variant="soft" onClick={() => void abrirDia(String(d.dtvenda))} />
      ),
    } as DataTableColumnDef<Dia>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const colsOp = useMemo<DataTableColumnDef<PorOperadora>[]>(() => [
    { field: 'operadora', headerName: 'Operadora', type: 'text', isPrimary: true },
    { field: 'total_vendas', headerName: 'Vendido', type: 'text', width: 150, valueGetter: (d) => moeda(d.total_vendas) },
    { field: 'recebidas', headerName: 'Já recebido', type: 'text', width: 150, valueGetter: (d) => moeda(d.recebidas) },
    { field: 'nao_recebidas', headerName: 'A receber', type: 'text', width: 150, valueGetter: (d) => moeda(d.nao_recebidas) },
    { field: 'lancamentos', headerName: 'Lançamentos', type: 'text', width: 125 },
  ], []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Fluxo de cartões" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Quanto a loja vendeu no cartão, <strong>quanto já caiu na conta e quanto ainda vai cair</strong>.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-40"><Field label="&Operadora (cód.)" value={f.codoperadora} onChange={(e) => setF({ ...f, codoperadora: e.target.value })} /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="E&xportar" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            exportarGradeCsv(res.linhas, [
              { titulo: 'Dia', valor: (d) => dataBr(d.dtvenda) },
              { titulo: 'Vendido', valor: (d) => d.total_vendas },
              { titulo: 'Já recebido', valor: (d) => d.recebidas },
              { titulo: 'A receber', valor: (d) => d.nao_recebidas },
              { titulo: 'Lançamentos', valor: (d) => d.lancamentos },
            ], 'fluxo-cartoes');
          }} />
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Dias</div><div className="text-body-lg tabular-nums">{res.totais.dias}</div></div>
              <div><div className="text-body-sm text-fg-muted">Vendido no cartão</div><div className="text-body-lg tabular-nums">{moeda(res.totais.total)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Já recebido</div><div className="text-body-lg tabular-nums text-fg-success">{moeda(res.totais.recebido)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Ainda a receber</div><div className="text-body-lg tabular-nums text-fg-warning">{moeda(res.totais.aReceber)}</div></div>
            </div>
          </section>
          <DataTable persistId="fluxo-cartoes" savedViewsService={gradeLayoutService}
            rows={res.linhas} columns={colsDia} getRowId={(d: Dia) => String(d.dtvenda)} />
        </>
      )}

      {dia && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="mb-form-gap flex items-center gap-gp-md">
            <div className="text-body-lg">Operadoras em {dataBr(dia.data)}</div>
            <Button label="&Fechar" variant="soft" onClick={() => setDia(null)} />
          </div>
          <DataTable persistId="fluxo-cartoes-operadora" savedViewsService={gradeLayoutService}
            rows={dia.linhas} columns={colsOp} getRowId={(d: PorOperadora) => String(d.codoperadora)} />
        </section>
      )}
    </div>
  );
}
