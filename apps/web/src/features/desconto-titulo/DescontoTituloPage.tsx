import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { gradeLayoutService } from '../../shared/grade/savedViewsService';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Operacao {
  operacao: number; codparceiro: number; parceiro: string | null; primeiro_vencimento: string;
  titulos: number; total_receber: number; total_pagar: number; diferenca: number;
  gerados: number; quitados: number;
}
interface Titulo {
  lado: string; codigo: number; duplicata: string; dtvenc: string; valor: number;
  quitada: string; gerado_pela_operacao: boolean; parceiro: string | null;
}
interface Resultado {
  linhas: Operacao[];
  totais: { operacoes: number; aReceber: number; aPagar: number; diferenca: number };
}

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));

/**
 * DESCONTO DE TÍTULOS (`FRMDESCONTOTITULO`). Dossiê: `uDescontoTitulo.md`.
 *
 * ⚠️ Apesar do nome, **não é desconto bancário de duplicata: é encontro de contas** entre um título a
 * receber e um a pagar do mesmo parceiro. O menor é abatido no maior, e a diferença vira um título novo.
 *
 * Corte-1: a consulta. Executar o encontro é o corte-2 — mexe em cinco tabelas numa transação.
 */
export function DescontoTituloPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: '', dataFim: '', codparceiro: '' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [det, setDet] = useState<{ operacao: number; titulos: Titulo[] } | null>(null);
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

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v !== '') q.set(k, String(v)); });
      setRes((await chamar(`cobranca/desconto-titulo?${q}`)) as Resultado);
      setDet(null);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const abrir = async (op: number) => {
    setOcupado(true);
    try {
      setDet({ operacao: op, titulos: (await chamar(`cobranca/desconto-titulo/${op}`)) as Titulo[] });
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const colsOp = useMemo<DataTableColumnDef<Operacao>[]>(() => [
    { field: 'operacao', headerName: 'Operação', type: 'text', width: 110, isPrimary: true },
    { field: 'parceiro', headerName: 'Parceiro', type: 'text' },
    { field: 'primeiro_vencimento', headerName: '1º vencimento', type: 'text', width: 130, valueGetter: (o) => dataBr(o.primeiro_vencimento) },
    { field: 'titulos', headerName: 'Títulos', type: 'text', width: 90 },
    { field: 'total_receber', headerName: 'A receber', type: 'text', width: 140, valueGetter: (o) => moeda(o.total_receber) },
    { field: 'total_pagar', headerName: 'A pagar', type: 'text', width: 140, valueGetter: (o) => moeda(o.total_pagar) },
    { field: 'diferenca', headerName: 'Diferença', type: 'text', width: 130, valueGetter: (o) => moeda(o.diferenca) },
    { field: 'gerados', headerName: 'Gerados', type: 'text', width: 95 },
    {
      field: 'acoes', headerName: '', type: 'text', width: 100, valueGetter: () => '',
      renderCell: ({ row: o }: { row: Operacao }) => (
        <Button label="Abrir" variant="soft" onClick={() => void abrir(o.operacao)} />
      ),
    } as DataTableColumnDef<Operacao>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const colsTit = useMemo<DataTableColumnDef<Titulo>[]>(() => [
    { field: 'lado', headerName: 'Lado', type: 'text', width: 80, isPrimary: true,
      valueGetter: (t) => (t.lado === 'RCB' ? 'A receber' : 'A pagar') },
    { field: 'codigo', headerName: 'Código', type: 'text', width: 100 },
    { field: 'duplicata', headerName: 'Duplicata', type: 'text', width: 140 },
    { field: 'dtvenc', headerName: 'Vencimento', type: 'text', width: 120, valueGetter: (t) => dataBr(t.dtvenc) },
    { field: 'valor', headerName: 'Valor', type: 'text', width: 130, valueGetter: (t) => moeda(t.valor) },
    { field: 'quitada', headerName: 'Quitado', type: 'text', width: 95, valueGetter: (t) => (t.quitada === 'S' ? 'Sim' : 'Não') },
    {
      // a marca que permite reverter a operação: distingue o que existia do que nasceu dela
      field: 'gerado_pela_operacao', headerName: 'Origem', type: 'text', width: 175, valueGetter: () => '',
      renderCell: ({ row: t }: { row: Titulo }) => (
        t.gerado_pela_operacao
          ? <span className="text-fg-info">gerado pela operação</span>
          : <span className="text-fg-muted">já existia</span>
      ),
    } as DataTableColumnDef<Titulo>,
  ], []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Desconto de títulos" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Apesar do nome, é <strong>encontro de contas</strong>: um título a receber contra um a pagar do
          mesmo parceiro. O menor é abatido no maior, e a diferença vira um título novo — marcado como
          &quot;gerado pela operação&quot;, que é o que permite reverter tudo depois.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="Vencimento &de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-40"><Field label="&Parceiro (cód.)" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value })} /></div>
          <Button label="&Buscar" disabled={ocupado} onClick={() => void buscar()} />
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Operações</div><div className="text-body-lg tabular-nums">{res.totais.operacoes}</div></div>
              <div><div className="text-body-sm text-fg-muted">Em títulos a receber</div><div className="text-body-lg tabular-nums">{moeda(res.totais.aReceber)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Em títulos a pagar</div><div className="text-body-lg tabular-nums">{moeda(res.totais.aPagar)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Diferença</div><div className="text-body-lg tabular-nums">{moeda(res.totais.diferenca)}</div></div>
            </div>
          </section>
          <DataTable persistId="desconto-titulo" savedViewsService={gradeLayoutService}
            rows={res.linhas} columns={colsOp} getRowId={(o: Operacao) => String(o.operacao)} />
        </>
      )}

      {det && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="mb-form-gap flex items-center gap-gp-md">
            <div className="text-body-lg">Títulos da operação {det.operacao}</div>
            <Button label="&Fechar" variant="soft" onClick={() => setDet(null)} />
          </div>
          <DataTable persistId="desconto-titulo-itens" savedViewsService={gradeLayoutService}
            rows={det.titulos} columns={colsTit} getRowId={(t: Titulo) => `${t.lado}-${t.codigo}`} />
        </section>
      )}
    </div>
  );
}
