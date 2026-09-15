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
  codproduto: number; codbarra: string; descricao: string; unidade: string;
  qtde: number; vrvenda: number; qtdecupom: number; pct_cupons: number;
}
interface Resultado {
  produto: { idproduto: number; descricao: string; codbarra: string } | null;
  linhas: Linha[];
  totais: { cupons: number; qtdeProduto: number; itensRelacionados: number };
}

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown, d = 3) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });
const hoje = () => new Date().toISOString().slice(0, 10);
const diasAtras = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/**
 * INTERSECÇÃO DE PRODUTOS (`FRMRELINTERSECCAOPRODUTOS`). Dossiê: `uRelInterseccaoProdutos.md`.
 *
 * **O que mais o cliente leva quando leva este produto.** Serve para decidir onde pôr a gôndola, o que
 * combinar em promoção e o que sugerir no PDV.
 */
export function RelInterseccaoPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    idproduto: '', dataIni: diasAtras(30), dataFim: hoje(), ordenarPor: 'QTDE', limite: '200',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    if (!f.idproduto) { mensagem.erro('Informe o produto a analisar.'); return; }
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v !== '') q.set(k, String(v)); });
      const r = await fetch(`${BASE}/relatorios/interseccao-produtos?${q}`, { headers: apiHeaders() });
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
    { field: 'codproduto', headerName: 'Código', type: 'text', width: 90, isPrimary: true },
    { field: 'descricao', headerName: 'Levado junto', type: 'text' },
    { field: 'unidade', headerName: 'Un.', type: 'text', width: 60 },
    { field: 'qtdecupom', headerName: 'Cupons', type: 'text', width: 100, valueGetter: (l) => nfmt(l.qtdecupom, 0) },
    {
      // a leitura que importa: em quantos por cento das compras do produto este item apareceu junto
      field: 'pct_cupons', headerName: '% dos cupons', type: 'text', width: 130, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Linha }) => {
        const p = Number(l.pct_cupons ?? 0);
        const cor = p >= 30 ? 'font-semibold text-fg-success' : p >= 10 ? 'text-fg-default' : 'text-fg-muted';
        return <span className={`${cor} tabular-nums`}>{nfmt(p, 2)}%</span>;
      },
    } as DataTableColumnDef<Linha>,
    { field: 'qtde', headerName: 'Qtde vendida', type: 'text', width: 130, valueGetter: (l) => nfmt(l.qtde) },
    { field: 'vrvenda', headerName: 'Valor vendido', type: 'text', width: 140, valueGetter: (l) => moeda(l.vrvenda) },
    { field: 'codbarra', headerName: 'Cód. barras', type: 'text', width: 140 },
  ], []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Intersecção de produtos" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          <strong>O que mais o cliente leva quando leva este produto.</strong> A conta olha os cupons que
          contêm o produto e soma tudo o que estava junto neles.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&Produto (código)" value={f.idproduto} onChange={(e) => setF({ ...f, idproduto: e.target.value })} /></div>
          <div className="w-40"><Field label="&de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Tipo de análise
            <select className="rounded border border-border px-1 py-1" value={f.ordenarPor}
              onChange={(e) => setF({ ...f, ordenarPor: e.target.value })}>
              <option value="QTDE">Qtde vendida</option>
              <option value="CUPOM">Qtde cupom</option>
            </select>
          </label>
          <div className="w-40"><Field label="Qtde itens &analisados" value={f.limite} onChange={(e) => setF({ ...f, limite: e.target.value })} /></div>
          <Button label="&Pesquisar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="E&xportar" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            exportarGradeCsv(res.linhas, [
              { titulo: 'Código', valor: (l) => l.codproduto },
              { titulo: 'Levado junto', valor: (l) => l.descricao },
              { titulo: 'Cupons', valor: (l) => l.qtdecupom },
              { titulo: '% dos cupons', valor: (l) => l.pct_cupons },
              { titulo: 'Qtde vendida', valor: (l) => l.qtde },
              { titulo: 'Valor vendido', valor: (l) => l.vrvenda },
            ], 'interseccao-produtos');
          }} />
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div>
                <div className="text-body-sm text-fg-muted">Produto analisado</div>
                <div className="text-body-lg">{res.produto?.descricao}</div>
              </div>
              <div><div className="text-body-sm text-fg-muted">Cupons com ele</div><div className="text-body-lg tabular-nums">{res.totais.cupons}</div></div>
              <div><div className="text-body-sm text-fg-muted">Qtde vendida</div><div className="text-body-lg tabular-nums">{nfmt(res.totais.qtdeProduto)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Itens relacionados</div><div className="text-body-lg tabular-nums">{res.totais.itensRelacionados}</div></div>
            </div>
            <p className="mt-form-gap text-body-sm text-fg-muted">
              O próprio produto não aparece na lista: ele está em 100% dos cupons por definição.
            </p>
          </section>
          <DataTable persistId="rel-interseccao" savedViewsService={gradeLayoutService}
            rows={res.linhas} columns={cols} getRowId={(l: Linha) => String(l.codproduto)} />
        </>
      )}
    </div>
  );
}
