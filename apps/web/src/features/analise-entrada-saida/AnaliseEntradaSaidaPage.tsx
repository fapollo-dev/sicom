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

interface Linha {
  codfor: number | null; fornecedor: string; codbarra: string; produto: string;
  desc_grupo: string; depto: string; qtd_entrada: number; qtd_saida: number; diferenca: number;
}
interface Resultado {
  origemSaida: 'VENDAS' | 'PEDIDOS';
  linhas: Linha[];
  totais: { itens: number; entrada: number; saida: number };
}

const nfmt = (v: unknown, d = 3) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

/**
 * ANÁLISE DE ENTRADA × SAÍDA (`FRMANALISEENTRADAXSAIDA`). Dossiê: `uAnaliseEntradaXSaida.md`.
 *
 * Por fornecedor e produto: quanto entrou pela nota e quanto saiu — e a saída pode vir das **vendas** ou dos
 * **pedidos**. Só quantidade: a pergunta aqui é de giro, não de dinheiro.
 *
 * Produto sem fornecedor, grupo ou departamento **aparece rotulado** em vez de sumir, que era o que
 * acontecia no sistema antigo.
 */
export function AnaliseEntradaSaidaPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: diaUm(), dataFim: hoje(), origemSaida: 'VENDAS',
    fornecedor: '', grupo: '', departamento: '',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v !== '') q.set(k, String(v)); });
      const r = await fetch(`${BASE}/relatorios/analise-entrada-saida?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const cols = useMemo<DataTableColumnDef<Linha>[]>(() => [
    { field: 'depto', headerName: 'Departamento', type: 'text', width: 175, isPrimary: true },
    { field: 'desc_grupo', headerName: 'Grupo', type: 'text', width: 165 },
    { field: 'fornecedor', headerName: 'Fornecedor', type: 'text', width: 200 },
    { field: 'produto', headerName: 'Produto', type: 'text' },
    { field: 'codbarra', headerName: 'Cód. barras', type: 'text', width: 140 },
    { field: 'qtd_entrada', headerName: 'Entrou', type: 'text', width: 110, valueGetter: (l) => nfmt(l.qtd_entrada) },
    { field: 'qtd_saida', headerName: 'Saiu', type: 'text', width: 110, valueGetter: (l) => nfmt(l.qtd_saida) },
    {
      field: 'diferenca', headerName: 'Diferença', type: 'text', width: 120, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Linha }) => (
        <span className={Number(l.diferenca) > 0 ? 'text-fg-warning tabular-nums' : 'tabular-nums'}>
          {nfmt(l.diferenca)}
        </span>
      ),
    } as DataTableColumnDef<Linha>,
  ], []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Análise de entrada × saída" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            A saída vem de
            <select className="rounded border border-border px-1 py-1" value={f.origemSaida}
              onChange={(e) => setF({ ...f, origemSaida: e.target.value })}>
              <option value="VENDAS">Vendas</option>
              <option value="PEDIDOS">Pedidos</option>
            </select>
          </label>
          <div className="w-48"><Field label="&Fornecedor" value={f.fornecedor} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} /></div>
          <div className="w-44"><Field label="G&rupo" value={f.grupo} onChange={(e) => setF({ ...f, grupo: e.target.value })} /></div>
          <div className="w-44"><Field label="De&partamento" value={f.departamento} onChange={(e) => setF({ ...f, departamento: e.target.value })} /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="E&xportar" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            exportarGradeCsv(res.linhas, [
              { titulo: 'Departamento', valor: (l) => l.depto },
              { titulo: 'Grupo', valor: (l) => l.desc_grupo },
              { titulo: 'Fornecedor', valor: (l) => l.fornecedor },
              { titulo: 'Produto', valor: (l) => l.produto },
              { titulo: 'Cód. barras', valor: (l) => l.codbarra },
              { titulo: 'Entrou', valor: (l) => l.qtd_entrada },
              { titulo: 'Saiu', valor: (l) => l.qtd_saida },
              { titulo: 'Diferença', valor: (l) => l.diferenca },
            ], 'analise-entrada-saida');
          }} />
        </div>
        <p className="mt-form-gap text-body-sm text-fg-muted">
          Os filtros de fornecedor, grupo e departamento só valem <strong>quando preenchidos</strong>. Produto
          sem esses cadastros aparece rotulado — no sistema antigo ele sumia do relatório sem aviso.
        </p>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Produtos</div><div className="text-body-lg tabular-nums">{res.totais.itens}</div></div>
              <div><div className="text-body-sm text-fg-muted">Entrou</div><div className="text-body-lg tabular-nums">{nfmt(res.totais.entrada)}</div></div>
              <div>
                <div className="text-body-sm text-fg-muted">Saiu ({res.origemSaida === 'PEDIDOS' ? 'pedidos' : 'vendas'})</div>
                <div className="text-body-lg tabular-nums">{nfmt(res.totais.saida)}</div>
              </div>
            </div>
          </section>
          <DataTable persistId="analise-entrada-saida" savedViewsService={gradeLayoutService}
            rows={res.linhas} columns={cols} getRowId={(l: Linha) => `${l.codbarra}-${l.codfor ?? 0}`} />
        </>
      )}
    </div>
  );
}
