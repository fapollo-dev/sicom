import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { gradeLayoutService } from '../../shared/grade/savedViewsService';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { hojeNaLoja } from '../../shared/tempo';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Tipo = 'AGRUPADO' | 'ANALITICO' | 'SINTETICO';
type Linha = Record<string, unknown>;
interface Resultado { tipo: Tipo; linhas: Linha[]; itens: Linha[]; empresas: number[] }

const nfmt = (v: unknown, d = 3) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));

/**
 * RELATÓRIO DE TROCA DE MERCADORIAS (`FRMRELTROCAMERCADORIAFOR`). Dossiê: `uRelTrocaMercadoriaFor.md`.
 *
 * As trocas com o fornecedor no período: analítico agrupado (a troca com os itens), analítico (item a item) ou sintético (por
 * produto). Aberto pela tela da troca (`?codtroca=N&daTroca=1`) fica preso naquela troca, como o legado desabilita data, troca e
 * fornecedor.
 */
export function RelTrocaMercadoriaPage() {
  const mensagem = useMensagem();
  const [params] = useSearchParams();
  const daTroca = params.get('daTroca') === '1' && !!params.get('codtroca');
  const [f, setF] = useState({
    tipo: 'AGRUPADO' as Tipo, dataIni: hojeNaLoja(), dataFim: hojeNaLoja(), status: 'TODOS',
    codtroca: params.get('codtroca') ?? '', codfor: '', idproduto: '', coddpto: '', codgrupo: '', codsubgrupo: '', empresas: '',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const consulta = () => {
    const q = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v !== '') q.set(k, String(v).replace(/\s/g, '')); });
    if (daTroca) { q.set('daTroca', 'true'); q.delete('dataIni'); q.delete('dataFim'); q.delete('codfor'); q.delete('empresas'); }
    return q.toString();
  };
  const imprimir = () => { imprimirRelatorio(`/relatorios/troca-mercadoria/impressao?${consulta()}`).catch((e) => mensagem.erro(e)); };

  const gerar = async () => {
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/relatorios/troca-mercadoria?${consulta()}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      const j = (await r.json()) as Resultado;
      // a chave da linha da grade: a posição (o analítico repete a linha do item quando ele tem mais de uma nota)
      setRes({ ...j, linhas: j.linhas.map((l, k) => ({ ...l, _k: k })) });
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  // os itens de cada troca (o nível de detalhe do analítico agrupado)
  const itensDaTroca = useMemo(() => {
    const m = new Map<number, Linha[]>();
    for (const i of res?.itens ?? []) m.set(Number(i.codtroca), [...(m.get(Number(i.codtroca)) ?? []), i]);
    return m;
  }, [res]);

  const cols = useMemo<DataTableColumnDef<Linha>[]>(() => {
    const t = (field: string, headerName: string, width?: number, fmt?: (v: unknown) => string): DataTableColumnDef<Linha> =>
      ({ field, headerName, type: 'text', ...(width ? { width } : {}), valueGetter: (l: Linha) => (fmt ? fmt(l[field]) : String(l[field] ?? '')) });
    if (res?.tipo === 'AGRUPADO') {
      return [
        { ...t('codtroca', 'Codtroca', 90), isPrimary: true },
        t('codempresa', 'Codempresa', 100), t('data', 'Data', 100, dataBr), t('codigo', 'Codigo', 80), t('fornecedor', 'Fornecedor', 240),
        t('descricao_troca', 'Descricao troca', 220), t('total', 'Total', 120, moeda),
        { field: 'itens', headerName: 'Itens', type: 'text', width: 360,
          valueGetter: (l: Linha) => (itensDaTroca.get(Number(l.codtroca)) ?? []).filter((i) => i.coditenstroca != null)
            .map((i) => `${i.descricao} (${nfmt(i.qtde)} × ${moeda(i.vrcusto)} — ${i.status})`).join('; ') },
      ];
    }
    if (res?.tipo === 'ANALITICO') {
      return [
        { ...t('codtroca', 'Codtroca', 90), isPrimary: true },
        t('coditenstroca', 'Coditenstroca', 110), t('data', 'Data', 100, dataBr), t('codparceiro', 'Codparceiro', 100), t('razao', 'Razao', 220),
        t('empresa', 'Empresa', 160), t('descricao_troca', 'Descricao troca', 200), t('codbarra', 'Codbarra', 130), t('descricao', 'Descricao'),
        t('status', 'Status', 90), t('qtde', 'Qtde', 90, nfmt), t('vrcusto', 'Vrcusto', 110, moeda), t('vrvenda', 'Vrvenda', 110, moeda), t('total', 'Total', 120, moeda),
      ];
    }
    return [
      { ...t('codbarra', 'Codbarra', 140), isPrimary: true },
      t('descricao', 'Descricao'), t('status', 'Status', 90), t('qtde', 'Qtde', 90, nfmt), t('vrcusto', 'Vrcusto', 110, moeda), t('vrvenda', 'Vrvenda', 110, moeda), t('total', 'Total', 120, moeda),
    ];
  }, [res, itensDaTroca]);

  const exportar = () => {
    if (!res?.linhas.length) return;
    const chaves = Object.keys(res.linhas[0]).filter((k) => k !== '_k');
    exportarGradeCsv(res.linhas, chaves.map((k) => ({ titulo: k.toUpperCase(), valor: (l: Linha) => (l[k] ?? '') as string | number })), 'troca-de-mercadorias');
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title={daTroca ? `Troca de mercadorias — troca nº ${f.codtroca}` : 'Troca de mercadorias'} />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Tipo do relatório
            <select className="rounded border border-border px-1 py-1" value={f.tipo} onChange={(e) => { setF({ ...f, tipo: e.target.value as Tipo }); setRes(null); }}>
              <option value="AGRUPADO">Analítico Agrupado</option>
              <option value="ANALITICO">Analítico</option>
              <option value="SINTETICO">Sintético</option>
            </select>
          </label>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Status Troca
            <select className="rounded border border-border px-1 py-1" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="ABERTO">Aberto</option>
              <option value="FECHADO">Fechado</option>
              <option value="TODOS">Todos</option>
            </select>
          </label>
          <div className="w-40"><Field label="&de" type="date" value={f.dataIni} disabled={daTroca} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} disabled={daTroca} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-28"><Field label="&Troca" value={f.codtroca} disabled={daTroca} onChange={(e) => setF({ ...f, codtroca: e.target.value })} /></div>
          <div className="w-32"><Field label="Fornecedor" value={f.codfor} disabled={daTroca} onChange={(e) => setF({ ...f, codfor: e.target.value })} /></div>
          {!daTroca && <div className="w-32"><Field label="&Empresas (1,2)" value={f.empresas} onChange={(e) => setF({ ...f, empresas: e.target.value })} placeholder="esta loja" /></div>}
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={ocupado} onClick={imprimir} />
          <Button label="E&xportar" variant="soft" disabled={!res?.linhas.length} onClick={exportar} />
        </div>
        <div className="mt-form-gap flex flex-wrap items-end gap-gp-sm">
          <div className="w-32"><Field label="Produto" value={f.idproduto} onChange={(e) => setF({ ...f, idproduto: e.target.value })} /></div>
          <div className="w-32"><Field label="Departamento" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-32"><Field label="Grupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
          <div className="w-32"><Field label="Subgrupo" value={f.codsubgrupo} onChange={(e) => setF({ ...f, codsubgrupo: e.target.value })} /></div>
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Registros</div><div className="text-body-lg tabular-nums">{res.linhas.length}</div></div>
              <div><div className="text-body-sm text-fg-muted">Total</div><div className="text-body-lg tabular-nums">{moeda(res.linhas.reduce((s, l) => s + Number(l.total ?? 0), 0))}</div></div>
              <div><div className="text-body-sm text-fg-muted">Lojas</div><div className="text-body-lg tabular-nums">{res.empresas.join(', ')}</div></div>
            </div>
          </section>
          <DataTable persistId={`rel-troca-mercadoria-${res.tipo.toLowerCase()}`} savedViewsService={gradeLayoutService}
            rows={res.linhas} columns={cols}
            getRowId={(l: Linha) => String(l._k)} />
        </>
      )}
    </div>
  );
}
