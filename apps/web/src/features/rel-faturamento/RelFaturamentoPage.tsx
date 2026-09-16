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

interface Mes {
  competencia: string; mes: number; ano: number; d1: string; d2: string;
  reducaoz: number; nota_fiscal: number; nfce: number; venda_liquida: number;
}
interface Resultado { linhas: Mes[]; totais: { reducaoz: number; notaFiscal: number; nfce: number; total: number } }

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const MESES = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const hoje = () => new Date().toISOString().slice(0, 10);
const anoAtras = () => new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);

/**
 * FATURAMENTO POR MÊS (`FRMRELFATURAMENTO`). Dossiê: `uRelFaturamento.md`.
 *
 * Quanto a loja faturou, mês a mês, com as **três origens separadas** — Redução Z do ECF, nota fiscal e
 * NFC-e. O relatório do legado só tinha as duas primeiras, e por isso mostrava quase nada num cliente que
 * fatura pelo balcão.
 */
export function RelFaturamentoPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: anoAtras(), dataFim: hoje() });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/relatorios/faturamento?dataIni=${f.dataIni}&dataFim=${f.dataFim}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const cols = useMemo<DataTableColumnDef<Mes>[]>(() => [
    { field: 'competencia', headerName: 'Competência', type: 'text', width: 140, isPrimary: true,
      valueGetter: (m) => `${MESES[m.mes] ?? m.mes}/${m.ano}` },
    { field: 'nfce', headerName: 'NFC-e (balcão)', type: 'text', width: 165, valueGetter: (m) => moeda(m.nfce) },
    { field: 'nota_fiscal', headerName: 'Nota fiscal', type: 'text', width: 150, valueGetter: (m) => moeda(m.nota_fiscal) },
    { field: 'reducaoz', headerName: 'Redução Z (ECF)', type: 'text', width: 160,
      valueGetter: (m) => (Number(m.reducaoz) > 0 ? moeda(m.reducaoz) : '—') },
    {
      field: 'venda_liquida', headerName: 'Faturamento', type: 'text', width: 170, valueGetter: () => '',
      renderCell: ({ row: m }: { row: Mes }) => <span className="font-semibold tabular-nums">{moeda(m.venda_liquida)}</span>,
    } as DataTableColumnDef<Mes>,
  ], []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Faturamento por mês" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="E&xportar" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            exportarGradeCsv(res.linhas, [
              { titulo: 'Competência', valor: (m) => m.competencia },
              { titulo: 'NFC-e', valor: (m) => m.nfce },
              { titulo: 'Nota fiscal', valor: (m) => m.nota_fiscal },
              { titulo: 'Redução Z', valor: (m) => m.reducaoz },
              { titulo: 'Faturamento', valor: (m) => m.venda_liquida },
            ], 'faturamento-mensal');
          }} />
        </div>
        <p className="mt-form-gap text-body-sm text-fg-muted">
          ⚠️ O faturamento aqui vem de <strong>três origens</strong>: a venda NFC-e do balcão, as notas
          fiscais de saída e a Redução Z do ECF. O sistema antigo somava apenas as duas últimas — numa loja
          que vende pelo balcão, isso deixava de fora quase todo o faturamento.
        </p>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Meses</div><div className="text-body-lg tabular-nums">{res.linhas.length}</div></div>
              <div><div className="text-body-sm text-fg-muted">NFC-e (balcão)</div><div className="text-body-lg tabular-nums">{moeda(res.totais.nfce)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Nota fiscal</div><div className="text-body-lg tabular-nums">{moeda(res.totais.notaFiscal)}</div></div>
              {res.totais.reducaoz > 0 && (
                <div><div className="text-body-sm text-fg-muted">Redução Z</div><div className="text-body-lg tabular-nums">{moeda(res.totais.reducaoz)}</div></div>
              )}
              <div>
                <div className="text-body-sm text-fg-muted">Faturamento do período</div>
                <div className="text-body-lg font-semibold tabular-nums">{moeda(res.totais.total)}</div>
              </div>
            </div>
          </section>
          <DataTable persistId="rel-faturamento" savedViewsService={gradeLayoutService}
            rows={res.linhas} columns={cols} getRowId={(m: Mes) => m.competencia} />
        </>
      )}
    </div>
  );
}
