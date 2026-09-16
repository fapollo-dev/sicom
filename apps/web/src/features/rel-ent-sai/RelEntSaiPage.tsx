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
  dpto: string | null; idempresa: number; codproduto: number; descricao: string;
  entradas: number; saidas: number; total_venda: number; total_compras: number;
  dif_qtde: number; dif_valor: number;
}
interface Resultado {
  linhas: Linha[];
  totais: { entradas: number; saidas: number; totalCompras: number; totalVenda: number; itens: number };
}

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown, d = 3) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

/**
 * ANÁLISE DE COMPRA × VENDA (`FRMRELENTSAI`). Dossiê: `uRelEntSai.md`.
 *
 * Por produto: quanto entrou pela nota e quanto saiu pela venda, em quantidade e em dinheiro. É a conta que
 * mostra o que se comprou demais e o que se vendeu sem repor.
 */
export function RelEntSaiPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: diaUm(), dataFim: hoje(), coddpto: '', codgrupo: '', idproduto: '', codfor: '',
    agruparProdutos: false,
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v !== '' && v !== false) q.set(k, String(v)); });
      const r = await fetch(`${BASE}/relatorios/compra-venda?${q}`, { headers: apiHeaders() });
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
    { field: 'descricao', headerName: 'Produto', type: 'text' },
    { field: 'dpto', headerName: 'Departamento', type: 'text', width: 165 },
    { field: 'entradas', headerName: 'Entrou', type: 'text', width: 110, valueGetter: (l) => nfmt(l.entradas) },
    { field: 'saidas', headerName: 'Saiu', type: 'text', width: 110, valueGetter: (l) => nfmt(l.saidas) },
    {
      // a leitura do comprador: negativo sobrou na prateleira, positivo vendeu sem repor
      field: 'dif_qtde', headerName: 'Diferença', type: 'text', width: 120, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Linha }) => (
        <span className={Number(l.dif_qtde) > 0 ? 'text-fg-warning tabular-nums' : 'tabular-nums'}>
          {nfmt(l.dif_qtde)}
        </span>
      ),
    } as DataTableColumnDef<Linha>,
    { field: 'total_compras', headerName: 'Comprado', type: 'text', width: 140, valueGetter: (l) => moeda(l.total_compras) },
    { field: 'total_venda', headerName: 'Vendido', type: 'text', width: 140, valueGetter: (l) => moeda(l.total_venda) },
    { field: 'dif_valor', headerName: 'Vendido − comprado', type: 'text', width: 170, valueGetter: (l) => moeda(l.dif_valor) },
  ], []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Análise de compra × venda" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Por produto: <strong>quanto entrou pela nota e quanto saiu pela venda</strong>. Diferença positiva
          quer dizer que vendeu mais do que comprou no período — saiu da prateleira.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-32"><Field label="De&partamento" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-32"><Field label="G&rupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
          <div className="w-32"><Field label="Pro&duto" value={f.idproduto} onChange={(e) => setF({ ...f, idproduto: e.target.value })} /></div>
          <div className="w-32"><Field label="&Fornecedor" value={f.codfor} onChange={(e) => setF({ ...f, codfor: e.target.value })} /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="E&xportar" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            exportarGradeCsv(res.linhas, [
              { titulo: 'Código', valor: (l) => l.codproduto },
              { titulo: 'Produto', valor: (l) => l.descricao },
              { titulo: 'Departamento', valor: (l) => l.dpto ?? '' },
              { titulo: 'Entrou', valor: (l) => l.entradas },
              { titulo: 'Saiu', valor: (l) => l.saidas },
              { titulo: 'Diferença', valor: (l) => l.dif_qtde },
              { titulo: 'Comprado', valor: (l) => l.total_compras },
              { titulo: 'Vendido', valor: (l) => l.total_venda },
            ], 'compra-venda');
          }} />
        </div>
        <label className="mt-form-gap flex items-center gap-gp-sm text-body-sm">
          <input type="checkbox" checked={f.agruparProdutos} onChange={(e) => setF({ ...f, agruparProdutos: e.target.checked })} />
          Agrupar produtos <span className="text-fg-muted">(junta as lojas numa linha só por produto)</span>
        </label>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Produtos</div><div className="text-body-lg tabular-nums">{res.totais.itens}</div></div>
              <div><div className="text-body-sm text-fg-muted">Entrou</div><div className="text-body-lg tabular-nums">{nfmt(res.totais.entradas)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Saiu</div><div className="text-body-lg tabular-nums">{nfmt(res.totais.saidas)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Comprado</div><div className="text-body-lg tabular-nums">{moeda(res.totais.totalCompras)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Vendido</div><div className="text-body-lg tabular-nums">{moeda(res.totais.totalVenda)}</div></div>
            </div>
          </section>
          <DataTable persistId="rel-ent-sai" savedViewsService={gradeLayoutService}
            rows={res.linhas} columns={cols} getRowId={(l: Linha) => `${l.codproduto}-${l.idempresa}`} />
        </>
      )}
    </div>
  );
}
