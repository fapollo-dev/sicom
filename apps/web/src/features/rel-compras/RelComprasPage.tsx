import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirPagina } from '../../shared/print/imprimirPagina';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Tipo = 'CATEGORIA' | 'CATEGORIA_ANALITICO' | 'COMPRAS_VENDAS';
interface Linha {
  idempresa?: number; fantasia?: string; data?: string;
  codsecao?: number; desc_secao?: string;
  coddpto?: number; descricao_departamento?: string;
  codgrupo?: number; desc_grupo?: string;
  codsubgrupo?: number; desc_subgrupo?: string;
  idproduto?: number; descricao?: string;
  total_compra: number; total_venda: number; total_porc: number;
}
interface Resultado { tipo: Tipo; considerar: string | null; campoData: string; linhas: Linha[]; totais: { compra: number; venda: number } }

const TIPOS: Array<{ v: Tipo; rotulo: string }> = [
  { v: 'CATEGORIA', rotulo: '1 - Compras por categoria' },
  { v: 'CATEGORIA_ANALITICO', rotulo: '2 - Compras por categoria analítico' },
  { v: 'COMPRAS_VENDAS', rotulo: '3 - Compras/Vendas departamento' },
];

/**
 * RELATÓRIOS DE COMPRAS (`FRMRELCOMPRAS`). Dossiê: `uRelCompras.md`.
 *
 * O que a loja comprou, pela árvore de categorias. O tipo escolhido muda a grade inteira — e no tipo 3 o
 * "considerar" decide se a coluna de venda entra, exatamente como o legado habilita o rádio só ali.
 */
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: unknown) => `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

export function RelComprasPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    tipo: 'CATEGORIA' as Tipo, dataIni: diaUm(), dataFim: hoje(),
    campoData: 'CONTABIL', considerar: 'COMPRAS',
    coddpto: '', codgrupo: '', codsubgrupo: '', codsecao: '', idproduto: '', codparceiro: '', cfops: '',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v !== '') q.set(k, String(v)); });
      // o "considerar" só existe no relatório 3; nos outros o legado desabilita o rádio
      if (f.tipo !== 'COMPRAS_VENDAS') q.delete('considerar');
      const r = await fetch(`${BASE}/relatorios/compras?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const cols = useMemo<DataTableColumnDef<Linha>[]>(() => {
    const base: DataTableColumnDef<Linha>[] = [];
    if (res?.tipo === 'COMPRAS_VENDAS') {
      base.push(
        { field: 'coddpto', headerName: 'Cód.', type: 'text', width: 80, isPrimary: true },
        { field: 'descricao_departamento', headerName: 'Departamento', type: 'text' },
      );
      if (res.considerar !== 'VENDAS') base.push({ field: 'total_compra', headerName: 'Compras', type: 'text', width: 140, valueGetter: (l) => moeda(l.total_compra) });
      if (res.considerar !== 'COMPRAS') base.push({ field: 'total_venda', headerName: 'Vendas', type: 'text', width: 140, valueGetter: (l) => moeda(l.total_venda) });
      return base;
    }
    base.push(
      { field: 'fantasia', headerName: 'Empresa', type: 'text', width: 150, isPrimary: true },
      { field: 'data', headerName: 'Data contábil', type: 'text', width: 115, valueGetter: (l) => dataBr(l.data) },
      { field: 'desc_secao', headerName: 'Seção', type: 'text', width: 150 },
      { field: 'descricao_departamento', headerName: 'Departamento', type: 'text', width: 170 },
      { field: 'desc_grupo', headerName: 'Grupo', type: 'text', width: 150 },
      { field: 'desc_subgrupo', headerName: 'Subgrupo', type: 'text', width: 150 },
    );
    if (res?.tipo === 'CATEGORIA_ANALITICO') {
      base.push(
        { field: 'idproduto', headerName: 'Produto', type: 'text', width: 90 },
        { field: 'descricao', headerName: 'Descrição', type: 'text' },
      );
    }
    base.push(
      { field: 'total_compra', headerName: 'Total compra', type: 'text', width: 140, valueGetter: (l) => moeda(l.total_compra) },
      { field: 'total_porc', headerName: '% do total', type: 'text', width: 105, valueGetter: (l) => pct(l.total_porc) },
    );
    return base;
  }, [res?.tipo, res?.considerar]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Relatórios de compras" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Tipo de relatório
            <select className="rounded border border-border px-1 py-1" value={f.tipo}
              onChange={(e) => setF({ ...f, tipo: e.target.value as Tipo })}>
              {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.rotulo}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Data
            <select className="rounded border border-border px-1 py-1" value={f.campoData}
              onChange={(e) => setF({ ...f, campoData: e.target.value })}>
              <option value="CONTABIL">Contábil</option>
              <option value="EMISSAO">Emissão</option>
              <option value="CHEGADA">Chegada</option>
            </select>
          </label>
          <div className="w-40"><Field label="&de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          {f.tipo === 'COMPRAS_VENDAS' && (
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Considerar
              <select className="rounded border border-border px-1 py-1" value={f.considerar}
                onChange={(e) => setF({ ...f, considerar: e.target.value })}>
                <option value="COMPRAS">Apenas compras</option>
                <option value="VENDAS">Apenas vendas</option>
                <option value="AMBOS">Compras e vendas</option>
              </select>
            </label>
          )}
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            const win = window.open('', '_blank', 'width=1024,height=768');
            if (!win) { mensagem.erro('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
            const raiz = document.getElementById('rel-compras-grade');
            if (!raiz) { win.close(); return; }
            // paisagem: a árvore inteira (seção → subgrupo) não cabe em retrato
            imprimirPagina(win, raiz, 'Relatórios de compras', undefined, true);
          }} />
        </div>
        <div className="mt-form-gap flex flex-wrap items-end gap-gp-sm">
          <div className="w-32"><Field label="Se&ção" value={f.codsecao} onChange={(e) => setF({ ...f, codsecao: e.target.value })} /></div>
          <div className="w-32"><Field label="De&partamento" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-32"><Field label="G&rupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
          <div className="w-32"><Field label="Su&bgrupo" value={f.codsubgrupo} onChange={(e) => setF({ ...f, codsubgrupo: e.target.value })} /></div>
          <div className="w-32"><Field label="Pro&duto" value={f.idproduto} onChange={(e) => setF({ ...f, idproduto: e.target.value })} /></div>
          <div className="w-32"><Field label="&Fornecedor" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value })} /></div>
          <div className="w-44"><Field label="C&FOPs (vírgula)" value={f.cfops} onChange={(e) => setF({ ...f, cfops: e.target.value })} /></div>
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Linhas</div><div className="text-body-lg tabular-nums">{res.linhas.length}</div></div>
              <div><div className="text-body-sm text-fg-muted">Total comprado</div><div className="text-body-lg tabular-nums">{moeda(res.totais.compra)}</div></div>
              {res.tipo === 'COMPRAS_VENDAS' && res.considerar !== 'COMPRAS' && (
                <div><div className="text-body-sm text-fg-muted">Total vendido</div><div className="text-body-lg tabular-nums">{moeda(res.totais.venda)}</div></div>
              )}
            </div>
            {res.tipo === 'COMPRAS_VENDAS' && res.considerar === 'AMBOS' && (
              <p className="mt-form-gap text-body-sm text-fg-muted">
                ⚠️ Neste modo o total vendido <strong>vai diferir do sistema antigo</strong>: lá o filtro de
                período e de loja ficou pendurado no <code>LEFT JOIN</code> e não filtrava nada, então a
                coluna somava a base inteira de vendas. Aqui ela respeita o período escolhido.
              </p>
            )}
          </section>
          <div id="rel-compras-grade">
            <DataTable rows={res.linhas} columns={cols} getRowId={(l: Linha) => `${l.idempresa ?? ''}-${l.data ?? ''}-${l.codsecao ?? ''}-${l.coddpto ?? ''}-${l.codgrupo ?? ''}-${l.codsubgrupo ?? ''}-${l.idproduto ?? ''}`} />
          </div>
        </>
      )}
    </div>
  );
}
