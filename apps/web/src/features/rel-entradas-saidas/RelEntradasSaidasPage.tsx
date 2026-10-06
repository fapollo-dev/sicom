import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirPagina } from '../../shared/print/imprimirPagina';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';
import { hojeNaLoja } from '../../shared/tempo';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Tipo = 'LISTAGEM' | 'COMPARATIVO';
interface Linha {
  tipo?: string; nronf?: string; dtcontabil?: string; grupo?: string | null; parceiro?: string | null;
  codproduto: number; codbarra?: string; descricao: string;
  quantidade?: number; valor?: number; valor_legado?: number;
  qtde_entrada?: number; valor_entrada?: number; qtde_saida?: number; valor_saida?: number;
  media_custo?: number; media_venda?: number; qtde_dif?: number; valor_dif?: number;
  qtde_estoque_loja?: number; qtde_estoque_deposito?: number; qtde_estoque_total?: number;
  vrcustorep?: number; vrvenda?: number;
  idempresa?: number; fantasia?: string | null; markup?: number | null; margem?: number | null; fatorcx?: number;
  ultima_nf_entrada?: string | null; data_ultima_nf_entrada?: string | null; dtvenda?: string | null;
  departamento?: string | null; secao?: string | null; codfor?: number | null; descricao_forn?: string | null;
}
interface Resultado { tipo: Tipo; linhas: Linha[]; totais: { entrada: number; saida: number; diferenca: number; itens: number } }

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown, d = 3) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => hojeNaLoja();
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

/**
 * ENTRADAS E SAÍDAS (`FRMRELENTRADASSAIDAS`). Dossiê: `uRelEntradasSaidas.md`.
 *
 * A listagem das notas do período e o comparativo por produto e loja — o comparativo é o do sistema atual (SQL
 * capturado na produção): notas de entrada e de saída pelo custo e as vendas do PDV, com estoques, markup e a última NF.
 */
export function RelEntradasSaidasPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    tipo: 'COMPARATIVO' as Tipo, dataIni: diaUm(), dataFim: hoje(),
    coddpto: '', codgrupo: '', codsubgrupo: '', codfor: '', produto: '', codproduto: '', empresas: '', horaIni: '00:00', horaFim: '23:59',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // os rádios do legado (rgCusto/rgVenda, o script do Rel_EntradasESaidas_Comparativo.fr3): a coluna de custo mostra o custo MÉDIO do
  // período ou o de REPOSIÇÃO atual; a de venda, a venda MÉDIA ou o valor de venda ATUAL
  const [custo, setCusto] = useState<'medio' | 'reposicao'>('medio');
  const [venda, setVenda] = useState<'media' | 'atual'>('media');

  // a listagem filtra pelo texto do produto; o comparativo, pelo código (o edtCodProd do legado)
  const params = () => {
    const q = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => {
      if (v === '') return;
      if (f.tipo === 'COMPARATIVO' && k === 'produto') return;
      if (f.tipo === 'LISTAGEM' && ['codproduto', 'empresas', 'horaIni', 'horaFim', 'codsubgrupo'].includes(k)) return;
      q.set(k, String(v));
    });
    return q;
  };

  const gerar = async () => {
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/relatorios/entradas-saidas?${params()}`, { headers: apiHeaders() });
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
      { field: 'fantasia', headerName: 'Loja', type: 'text', width: 120 },
      { field: 'codproduto', headerName: 'Código', type: 'text', width: 90, isPrimary: true },
      { field: 'codbarra', headerName: 'Cód. barra', type: 'text', width: 130 },
      { field: 'descricao', headerName: 'Produto', type: 'text' },
      { field: 'qtde_entrada', headerName: 'Qtde entrada', type: 'text', width: 120, valueGetter: (l) => nfmt(l.qtde_entrada) },
      { field: 'valor_entrada', headerName: 'Valor entrada', type: 'text', width: 140, valueGetter: (l) => moeda(l.valor_entrada) },
      custo === 'medio'
        ? { field: 'media_custo', headerName: 'Custo médio', type: 'text', width: 120, valueGetter: (l) => moeda(l.media_custo) }
        : { field: 'vrcustorep', headerName: 'Custo rep.', type: 'text', width: 120, valueGetter: (l) => moeda(l.vrcustorep) },
      { field: 'qtde_saida', headerName: 'Qtde saída', type: 'text', width: 110, valueGetter: (l) => nfmt(l.qtde_saida) },
      { field: 'valor_saida', headerName: 'Valor saída', type: 'text', width: 140, valueGetter: (l) => moeda(l.valor_saida) },
      venda === 'media'
        ? { field: 'media_venda', headerName: 'Venda média', type: 'text', width: 120, valueGetter: (l) => moeda(l.media_venda) }
        : { field: 'vrvenda', headerName: 'Venda valor', type: 'text', width: 120, valueGetter: (l) => moeda(l.vrvenda) },
      { field: 'qtde_dif', headerName: 'Dif. qtde', type: 'text', width: 100, valueGetter: (l) => nfmt(l.qtde_dif) },
      { field: 'valor_dif', headerName: 'Dif. valor', type: 'text', width: 130, valueGetter: (l) => moeda(l.valor_dif) },
      { field: 'qtde_estoque_loja', headerName: 'Estoque loja', type: 'text', width: 115, valueGetter: (l) => nfmt(l.qtde_estoque_loja) },
      { field: 'qtde_estoque_deposito', headerName: 'Estoque depósito', type: 'text', width: 130, valueGetter: (l) => nfmt(l.qtde_estoque_deposito) },
      { field: 'qtde_estoque_total', headerName: 'Estoque total', type: 'text', width: 120, valueGetter: (l) => nfmt(l.qtde_estoque_total) },
      { field: 'vrcustorep', headerName: 'Custo reposição', type: 'text', width: 130, valueGetter: (l) => moeda(l.vrcustorep) },
      { field: 'vrvenda', headerName: 'Preço atual', type: 'text', width: 120, valueGetter: (l) => moeda(l.vrvenda) },
      { field: 'markup', headerName: 'Markup %', type: 'text', width: 100, valueGetter: (l) => (l.markup == null ? '' : nfmt(l.markup, 2)) },
      { field: 'margem', headerName: 'Margem %', type: 'text', width: 100, valueGetter: (l) => (l.margem == null ? '' : nfmt(l.margem, 2)) },
      { field: 'ultima_nf_entrada', headerName: 'Última NF entrada', type: 'text', width: 140 },
      { field: 'data_ultima_nf_entrada', headerName: 'Emissão última NF', type: 'text', width: 140, valueGetter: (l) => dataBr(l.data_ultima_nf_entrada) },
      { field: 'dtvenda', headerName: 'Último movimento', type: 'text', width: 130, valueGetter: (l) => dataBr(l.dtvenda) },
      { field: 'departamento', headerName: 'Departamento', type: 'text', width: 140 },
      { field: 'grupo', headerName: 'Grupo', type: 'text', width: 140 },
      { field: 'descricao_forn', headerName: 'Fornecedor', type: 'text', width: 180 },
    ];
  }, [res?.tipo, custo, venda]);

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
          <div className="w-40"><Field label="até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-32"><Field label="Departamento" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-32"><Field label="Grupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
          <div className="w-32"><Field label="Fornecedor" value={f.codfor} onChange={(e) => setF({ ...f, codfor: e.target.value })} /></div>
          {f.tipo === 'LISTAGEM'
            ? <div className="w-52"><Field label="Pr&oduto ou cód. barra" value={f.produto} onChange={(e) => setF({ ...f, produto: e.target.value })} /></div>
            : <>
                <div className="w-32"><Field label="Subgrupo" value={f.codsubgrupo} onChange={(e) => setF({ ...f, codsubgrupo: e.target.value })} /></div>
                <div className="w-32"><Field label="Pr&oduto (código)" value={f.codproduto} onChange={(e) => setF({ ...f, codproduto: e.target.value.replace(/\D/g, '') })} /></div>
                <div className="w-24"><Field label="Hora inicial" value={f.horaIni} onChange={(e) => setF({ ...f, horaIni: e.target.value })} /></div>
                <div className="w-24"><Field label="Hora final" value={f.horaFim} onChange={(e) => setF({ ...f, horaFim: e.target.value })} /></div>
                <div className="w-40"><Field label="&Empresas (1,2)" value={f.empresas} onChange={(e) => setF({ ...f, empresas: e.target.value.replace(/[^\d,]/g, '') })} placeholder="esta loja" /></div>
              </>}
          {f.tipo === 'COMPARATIVO' && (
            <div className="flex flex-col gap-gp-xs text-body-sm">
              <span className="flex items-center gap-gp-sm">Custo:
                <label className="flex items-center gap-gp-xs"><input type="radio" name="es-custo" checked={custo === 'medio'} onChange={() => setCusto('medio')} /> Médio</label>
                <label className="flex items-center gap-gp-xs"><input type="radio" name="es-custo" checked={custo === 'reposicao'} onChange={() => setCusto('reposicao')} /> Reposição</label>
              </span>
              <span className="flex items-center gap-gp-sm">Venda:
                <label className="flex items-center gap-gp-xs"><input type="radio" name="es-venda" checked={venda === 'media'} onChange={() => setVenda('media')} /> Média</label>
                <label className="flex items-center gap-gp-xs"><input type="radio" name="es-venda" checked={venda === 'atual'} onChange={() => setVenda('atual')} /> Valor atual</label>
              </span>
            </div>
          )}
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            if (res.tipo === 'COMPARATIVO') {
              // o layout do cliente (Rel_EntradasESaidas_Comparativo.fr3), com os rádios de custo e de venda
              const q = params();
              q.set('custo', custo === 'medio' ? '0' : '1');
              q.set('venda', venda === 'media' ? '0' : '1');
              void imprimirRelatorio(`/relatorios/entradas-saidas/impressao?${q.toString()}`).catch((e) => mensagem.erro(e));
              return;
            }
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
            {res.tipo === 'LISTAGEM' && <p className="mt-form-gap text-body-sm text-fg-muted">
              ⚠️ O valor das entradas <strong>vai diferir do sistema antigo</strong>: lá o desconto do item era
              subtraído como se fosse reais, mas ele é <strong>percentual</strong>. Só nas entradas de 2026 isso
              inflava o total em <strong>R$ 178.994,93</strong>. Aqui usamos o valor do desconto em reais.
              {' A coluna "Sistema antigo" mostra o número que o legado daria.'}
            </p>}
          </section>
          <div id="es-grade">
            <DataTable rows={res.linhas} columns={cols} getRowId={(l: Linha, i?: number) => `${l.idempresa ?? ''}-${l.codproduto}-${l.nronf ?? ''}-${i ?? ''}`} />
          </div>
        </>
      )}
    </div>
  );
}
