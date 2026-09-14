import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirPagina } from '../../shared/print/imprimirPagina';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Tipo = 'LISTAGEM' | 'COMPARATIVO';
interface Linha {
  tipo?: string; nronf?: string; dtcontabil?: string; grupo?: string | null; parceiro?: string | null;
  codproduto: number; codbarra?: string; descricao: string;
  quantidade?: number; valor?: number; valor_legado?: number;
  qtde_entrada?: number; valor_entrada?: number; qtde_saida?: number; valor_saida?: number;
  media_custo?: number; media_venda?: number; qtde_dif?: number; valor_dif?: number;
  qtde_estoque_loja?: number; qtde_estoque_deposito?: number; qtde_estoque_total?: number;
  vrcustorep?: number; vrvenda?: number; vaberto?: number;
}
interface Resultado { tipo: Tipo; linhas: Linha[]; totais: { entrada: number; saida: number; diferenca: number; itens: number } }

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown, d = 3) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

/**
 * ENTRADAS E SAÍDAS (`FRMRELENTRADASSAIDAS`). Dossiê: `uRelEntradasSaidas.md`.
 *
 * A listagem das notas do período e o comparativo por produto — quanto entrou, quanto saiu, e a posição de
 * estoque ao lado. O valor do item difere do sistema antigo, e a tela diz por quê.
 */
export function RelEntradasSaidasPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    tipo: 'COMPARATIVO' as Tipo, dataIni: diaUm(), dataFim: hoje(),
    coddpto: '', codgrupo: '', codfor: '', produto: '',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v !== '') q.set(k, String(v)); });
      const r = await fetch(`${BASE}/relatorios/entradas-saidas?${q}`, { headers: apiHeaders() });
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
    if (res?.tipo === 'LISTAGEM') {
      return [
        { field: 'tipo', headerName: 'E/S', type: 'text', width: 60, isPrimary: true },
        { field: 'nronf', headerName: 'NF', type: 'text', width: 90 },
        { field: 'dtcontabil', headerName: 'Contábil', type: 'text', width: 105, valueGetter: (l) => dataBr(l.dtcontabil) },
        { field: 'parceiro', headerName: 'Parceiro', type: 'text', width: 180 },
        { field: 'grupo', headerName: 'Grupo', type: 'text', width: 150 },
        { field: 'descricao', headerName: 'Produto', type: 'text' },
        { field: 'quantidade', headerName: 'Qtde', type: 'text', width: 100, valueGetter: (l) => nfmt(l.quantidade) },
        { field: 'valor', headerName: 'Valor', type: 'text', width: 130, valueGetter: (l) => moeda(l.valor) },
        { field: 'valor_legado', headerName: 'Sistema antigo', type: 'text', width: 140, valueGetter: (l) => moeda(l.valor_legado) },
      ];
    }
    return [
      { field: 'codproduto', headerName: 'Código', type: 'text', width: 90, isPrimary: true },
      { field: 'descricao', headerName: 'Produto', type: 'text' },
      { field: 'qtde_entrada', headerName: 'Qtde entrada', type: 'text', width: 120, valueGetter: (l) => nfmt(l.qtde_entrada) },
      { field: 'valor_entrada', headerName: 'Valor entrada', type: 'text', width: 140, valueGetter: (l) => moeda(l.valor_entrada) },
      { field: 'media_custo', headerName: 'Custo médio', type: 'text', width: 120, valueGetter: (l) => moeda(l.media_custo) },
      { field: 'qtde_saida', headerName: 'Qtde saída', type: 'text', width: 110, valueGetter: (l) => nfmt(l.qtde_saida) },
      { field: 'valor_saida', headerName: 'Valor saída', type: 'text', width: 140, valueGetter: (l) => moeda(l.valor_saida) },
      { field: 'media_venda', headerName: 'Venda média', type: 'text', width: 120, valueGetter: (l) => moeda(l.media_venda) },
      { field: 'qtde_dif', headerName: 'Dif. qtde', type: 'text', width: 100, valueGetter: (l) => nfmt(l.qtde_dif) },
      { field: 'valor_dif', headerName: 'Dif. valor', type: 'text', width: 130, valueGetter: (l) => moeda(l.valor_dif) },
      { field: 'qtde_estoque_loja', headerName: 'Estoque loja', type: 'text', width: 120, valueGetter: (l) => nfmt(l.qtde_estoque_loja) },
      { field: 'vaberto', headerName: 'A entrar', type: 'text', width: 100, valueGetter: (l) => nfmt(l.vaberto) },
      { field: 'vrvenda', headerName: 'Preço atual', type: 'text', width: 120, valueGetter: (l) => moeda(l.vrvenda) },
    ];
  }, [res?.tipo]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Entradas e saídas" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Relatório
            <select className="rounded border border-border px-1 py-1" value={f.tipo}
              onChange={(e) => setF({ ...f, tipo: e.target.value as Tipo })}>
              <option value="LISTAGEM">1 - Entradas e saídas</option>
              <option value="COMPARATIVO">2 - Entradas e saídas · comparativo</option>
            </select>
          </label>
          <div className="w-40"><Field label="Contábil &de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-32"><Field label="De&partamento" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-32"><Field label="G&rupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
          <div className="w-32"><Field label="&Fornecedor" value={f.codfor} onChange={(e) => setF({ ...f, codfor: e.target.value })} /></div>
          <div className="w-52"><Field label="Pr&oduto ou cód. barra" value={f.produto} onChange={(e) => setF({ ...f, produto: e.target.value })} /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            const win = window.open('', '_blank', 'width=1024,height=768');
            if (!win) { mensagem.erro('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
            const raiz = document.getElementById('es-grade');
            if (!raiz) { win.close(); return; }
            imprimirPagina(win, raiz, 'Entradas e saídas', undefined, true);
          }} />
          <Button label="E&xportar" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            exportarGradeCsv(res.linhas, cols.map((c) => ({
              titulo: String(c.headerName ?? c.field),
              valor: (l: Linha) => (c.valueGetter ? c.valueGetter(l) : (l as unknown as Record<string, unknown>)[c.field as string]),
            })), 'entradas-saidas');
          }} />
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Linhas</div><div className="text-body-lg tabular-nums">{res.totais.itens}</div></div>
              <div><div className="text-body-sm text-fg-muted">Total entradas</div><div className="text-body-lg tabular-nums">{moeda(res.totais.entrada)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Total saídas</div><div className="text-body-lg tabular-nums">{moeda(res.totais.saida)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Diferença</div><div className="text-body-lg tabular-nums">{moeda(res.totais.diferenca)}</div></div>
            </div>
            <p className="mt-form-gap text-body-sm text-fg-muted">
              ⚠️ O valor das entradas <strong>vai diferir do sistema antigo</strong>: lá o desconto do item era
              subtraído como se fosse reais, mas ele é <strong>percentual</strong>. Só nas entradas de 2026 isso
              inflava o total em <strong>R$ 178.994,93</strong>. Aqui usamos o valor do desconto em reais.
              {res.tipo === 'LISTAGEM' && ' A coluna "Sistema antigo" mostra o número que o legado daria.'}
            </p>
          </section>
          <div id="es-grade">
            <DataTable rows={res.linhas} columns={cols} getRowId={(l: Linha, i?: number) => `${l.codproduto}-${l.nronf ?? ''}-${i ?? ''}`} />
          </div>
        </>
      )}
    </div>
  );
}
