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
  idproduto: number; codbarra: string; descricao: string;
  qtde_estoque: number; qtde_vendida: number; media_diaria: number | null;
  cobertura: number | null; sem_venda: boolean;
  departamento: string | null; grupo: string | null;
  vrcusto: number; vrvenda: number; valor_parado: number;
}
interface Resultado {
  dias: number; linhas: Linha[];
  totais: { itens: number; semVenda: number; emRuptura: number; estoqueTotal: number };
}

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown, d = 3) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });

/**
 * DIAS DE ESTOQUE / COBERTURA (`FRMRELDDE`). Dossiê: `uRelDDE.md`.
 *
 * Responde a pergunta que decide a compra: **com o que tenho na prateleira, quantos dias eu aguento?**
 *
 * O legado grava `-999999` quando o produto não vendeu no período — um sentinela numérico que, mostrado como
 * está, poria "-999999 dias" na frente do comprador e jogaria esses itens para o topo ao ordenar. Aqui eles
 * aparecem como **"sem venda no período"**, separados dos que têm cobertura de verdade.
 */
export function RelDdePage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dias: '30', coberturaAte: '', somenteVendidos: true,
    coddpto: '', codgrupo: '', produto: '',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v !== '' && v !== false) q.set(k, String(v)); });
      const r = await fetch(`${BASE}/relatorios/dias-estoque?${q}`, { headers: apiHeaders() });
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
    { field: 'idproduto', headerName: 'Código', type: 'text', width: 90, isPrimary: true },
    { field: 'descricao', headerName: 'Produto', type: 'text' },
    { field: 'qtde_estoque', headerName: 'Estoque', type: 'text', width: 110, valueGetter: (l) => nfmt(l.qtde_estoque) },
    { field: 'qtde_vendida', headerName: 'Vendido no período', type: 'text', width: 150, valueGetter: (l) => nfmt(l.qtde_vendida) },
    { field: 'media_diaria', headerName: 'Média/dia', type: 'text', width: 110,
      valueGetter: (l) => (l.media_diaria == null ? '—' : nfmt(l.media_diaria)) },
    {
      // o número que decide a compra — e o "sem venda" no lugar do sentinela do legado
      field: 'cobertura', headerName: 'Cobertura (dias)', type: 'text', width: 150, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Linha }) => {
        if (l.sem_venda) return <span className="text-fg-muted">sem venda no período</span>;
        const c = Number(l.cobertura ?? 0);
        const cor = c <= 3 ? 'font-semibold text-fg-danger' : c <= 7 ? 'text-fg-warning' : 'text-fg-default';
        return <span className={`${cor} tabular-nums`}>{nfmt(c, 0)}</span>;
      },
    } as DataTableColumnDef<Linha>,
    { field: 'valor_parado', headerName: 'Valor parado', type: 'text', width: 130, valueGetter: (l) => moeda(l.valor_parado) },
    { field: 'vrvenda', headerName: 'Preço', type: 'text', width: 110, valueGetter: (l) => moeda(l.vrvenda) },
    { field: 'departamento', headerName: 'Departamento', type: 'text', width: 165 },
    { field: 'grupo', headerName: 'Grupo', type: 'text', width: 155 },
  ], []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Dias de estoque (cobertura)" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          <strong>Com o que tenho na prateleira, quantos dias eu aguento?</strong> A média diária sai da venda
          da janela escolhida; a cobertura é o estoque dividido por ela.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-44"><Field label="&Janela de venda (dias)" value={f.dias} onChange={(e) => setF({ ...f, dias: e.target.value })} /></div>
          <div className="w-44"><Field label="&Cobertura até (dias)" value={f.coberturaAte} onChange={(e) => setF({ ...f, coberturaAte: e.target.value })} placeholder="todas" /></div>
          <div className="w-32"><Field label="De&partamento" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-32"><Field label="G&rupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
          <div className="w-52"><Field label="Pro&duto ou cód. barra" value={f.produto} onChange={(e) => setF({ ...f, produto: e.target.value })} /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="E&xportar" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            exportarGradeCsv(res.linhas, [
              { titulo: 'Código', valor: (l) => l.idproduto },
              { titulo: 'Cód. barras', valor: (l) => l.codbarra },
              { titulo: 'Produto', valor: (l) => l.descricao },
              { titulo: 'Estoque', valor: (l) => l.qtde_estoque },
              { titulo: 'Vendido no período', valor: (l) => l.qtde_vendida },
              { titulo: 'Média/dia', valor: (l) => l.media_diaria ?? '' },
              { titulo: 'Cobertura (dias)', valor: (l) => (l.sem_venda ? 'sem venda no período' : l.cobertura ?? '') },
              { titulo: 'Valor parado', valor: (l) => l.valor_parado },
              { titulo: 'Departamento', valor: (l) => l.departamento ?? '' },
            ], 'dias-de-estoque');
          }} />
        </div>
        <label className="mt-form-gap flex items-center gap-gp-sm text-body-sm">
          <input type="checkbox" checked={f.somenteVendidos} onChange={(e) => setF({ ...f, somenteVendidos: e.target.checked })} />
          Só os que <strong>venderam</strong> no período
          <span className="text-fg-muted">(desmarcado, traz também o que está parado na prateleira)</span>
        </label>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Produtos</div><div className="text-body-lg tabular-nums">{res.totais.itens}</div></div>
              <div>
                <div className="text-body-sm text-fg-muted">Cobrem até 7 dias</div>
                <div className="text-body-lg tabular-nums text-fg-danger">{res.totais.emRuptura}</div>
              </div>
              <div><div className="text-body-sm text-fg-muted">Sem venda no período</div><div className="text-body-lg tabular-nums">{res.totais.semVenda}</div></div>
              <div><div className="text-body-sm text-fg-muted">Janela</div><div className="text-body-lg tabular-nums">{res.dias} dias</div></div>
            </div>
          </section>
          <DataTable persistId="rel-dde" savedViewsService={gradeLayoutService}
            rows={res.linhas} columns={cols} getRowId={(l: Linha) => String(l.idproduto)} />
        </>
      )}
    </div>
  );
}
