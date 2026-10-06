import { useMemo, useRef, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { useShortcut } from '../../shared/keyboard';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { gradeLayoutService } from '../../shared/grade/savedViewsService';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Titulo {
  codigo: number; duplicata: string; dtvenda: string; dtvenc: string; valor: number; txjuros: number; atraso: number; tolerancia: number;
  juro: number; total: number; desconto_cliente: number; nrocupom: string | null; obs: string | null; codempresa: number; nropedido: string | null;
  pdv: string | null; vencido: boolean; sel: boolean;
}
interface Resultado {
  cliente: string | null; taxa: number; juroAte: string; titulos: Titulo[]; saldoCliente: number;
  totais: {
    titulos: number; geral: number; atraso: number; geralComJuros: number; atrasoComJuros: number;
    selecionados: number; selValor: number; selComJuros: number; selJuros: number; selDescontos: number;
  };
}

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));

/**
 * CONSULTA A RECEBER POR CLIENTE (`FRMCONSCLIRCB`). Dossiê: `uConsCliRcb.md`.
 *
 * Os títulos em aberto do cliente (todas as lojas, sem os agrupados) com o juro pela taxa da tela — a padrão da empresa, que o operador
 * pode trocar — até a data do "juros até". Clicar no título marca/desmarca (os totais da seleção); "Todos" marca tudo (a tecla T do
 * legado); "Imprimir" imprime os marcados no layout do cliente.
 */
export function ConsCliRcbPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ codparceiro: '', taxa: '', juroAte: '' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const jurosRef = useRef<HTMLInputElement>(null);
  // F8 = edtJuro.SetFocus (FormKeyDown do UConsCliRcb) — o campo só fica habilitado depois da consulta
  useShortcut('f8', () => jurosRef.current?.focus(), { when: !!res });

  const params = (marcados: number[], comTaxa: boolean) => {
    const q = new URLSearchParams({ codparceiro: f.codparceiro });
    if (comTaxa && f.taxa !== '') q.set('taxa', f.taxa.replace(',', '.'));
    if (comTaxa && f.juroAte) q.set('juroAte', f.juroAte);
    if (marcados.length) q.set('selecionados', marcados.join(','));
    return q;
  };

  // comTaxa = falso na troca de cliente: o legado repõe a taxa padrão da empresa (edtCodClienteExit)
  const consultar = async (marcados: number[], comTaxa: boolean) => {
    if (!f.codparceiro) { mensagem.erro('Informe o cliente.'); return; }
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/cobranca/cons-cli-rcb?${params(marcados, comTaxa)}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      const j = (await r.json()) as Resultado;
      setRes(j);
      setSel(marcados);
      if (!comTaxa) setF((x) => ({ ...x, taxa: String(j.taxa ?? 0), juroAte: j.juroAte }));
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const alternar = (codigo: number) => void consultar(sel.includes(codigo) ? sel.filter((c) => c !== codigo) : [...sel, codigo], true);

  const cols = useMemo<DataTableColumnDef<Titulo>[]>(() => [
    {
      field: 'sel', headerName: '', type: 'text', width: 50, valueGetter: () => '',
      renderCell: ({ row: t }: { row: Titulo }) => <input type="checkbox" checked={t.sel} onChange={() => alternar(t.codigo)} aria-label={`Marcar o título ${t.codigo}`} />,
    } as DataTableColumnDef<Titulo>,
    { field: 'codigo', headerName: 'Código', type: 'text', width: 95, isPrimary: true },
    { field: 'dtvenda', headerName: 'Venda', type: 'text', width: 105, valueGetter: (t) => dataBr(t.dtvenda) },
    {
      // vencido em vermelho, como a grade do legado
      field: 'dtvenc', headerName: 'Vencimento', type: 'text', width: 115, valueGetter: () => '',
      renderCell: ({ row: t }: { row: Titulo }) => <span className={t.vencido ? 'font-semibold text-fg-danger' : 'font-semibold'}>{dataBr(t.dtvenc)}</span>,
    } as DataTableColumnDef<Titulo>,
    { field: 'valor', headerName: 'Valor', type: 'text', width: 115, valueGetter: (t) => moeda(t.valor) },
    { field: 'atraso', headerName: 'Atraso', type: 'text', width: 85 },
    { field: 'tolerancia', headerName: 'Tolerância', type: 'text', width: 100 },
    { field: 'txjuros', headerName: 'Tx. juros', type: 'text', width: 95, valueGetter: (t) => moeda(t.txjuros) },
    { field: 'juro', headerName: 'Juro', type: 'text', width: 105, valueGetter: (t) => moeda(t.juro) },
    { field: 'desconto_cliente', headerName: 'Desconto', type: 'text', width: 105, valueGetter: (t) => moeda(t.desconto_cliente) },
    { field: 'total', headerName: 'Total', type: 'text', width: 115, valueGetter: (t) => moeda(t.total) },
    { field: 'duplicata', headerName: 'Duplicata', type: 'text', width: 130 },
    { field: 'nrocupom', headerName: 'Cupom', type: 'text', width: 95 },
    { field: 'pdv', headerName: 'PDV', type: 'text', width: 70 },
    { field: 'codempresa', headerName: 'Loja', type: 'text', width: 70 },
    { field: 'obs', headerName: 'Obs.', type: 'text', width: 200 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [sel, f]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="A receber por cliente" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&Cliente (código)" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value.replace(/\D/g, '') })} /></div>
          <Button label="&Consultar" disabled={ocupado} onClick={() => void consultar([], false)} />
          <div className="w-32"><Field ref={jurosRef} label="&Juros (% a.m.)" value={f.taxa} disabled={!res} onChange={(e) => setF({ ...f, taxa: e.target.value })} /></div>
          <div className="w-40"><Field label="Juros &até" type="date" value={f.juroAte} disabled={!res} onChange={(e) => setF({ ...f, juroAte: e.target.value })} /></div>
          <Button label="&Recalcular" variant="soft" disabled={!res || ocupado} onClick={() => void consultar(sel, true)} />
          <Button label="&Todos" variant="soft" disabled={!res || ocupado} onClick={() => void consultar((res?.titulos ?? []).map((t) => t.codigo), true)} />
          <Button label="&Imprimir" variant="soft" disabled={!res || ocupado} onClick={() => {
            void imprimirRelatorio(`/cobranca/cons-cli-rcb/impressao?${params(sel, true).toString()}`).catch((e) => mensagem.erro(e));
          }} />
          <Button label="E&xportar" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            exportarGradeCsv(res.titulos, [
              { titulo: 'Código', valor: (t) => t.codigo },
              { titulo: 'Venda', valor: (t) => dataBr(t.dtvenda) },
              { titulo: 'Vencimento', valor: (t) => dataBr(t.dtvenc) },
              { titulo: 'Valor', valor: (t) => t.valor },
              { titulo: 'Atraso', valor: (t) => t.atraso },
              { titulo: 'Juro', valor: (t) => t.juro },
              { titulo: 'Desconto', valor: (t) => t.desconto_cliente },
              { titulo: 'Total', valor: (t) => t.total },
              { titulo: 'Duplicata', valor: (t) => t.duplicata },
            ], 'a-receber-cliente');
          }} />
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Cliente</div><div className="text-body-lg">{res.cliente ?? '—'}</div></div>
              <div><div className="text-body-sm text-fg-muted">Saldo do cliente</div><div className="text-body-lg tabular-nums">{moeda(res.saldoCliente)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Total geral</div><div className="text-body-lg tabular-nums">{moeda(res.totais.geral)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Total em atraso</div><div className="text-body-lg tabular-nums text-fg-danger">{moeda(res.totais.atraso)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Geral c/ juros</div><div className="text-body-lg tabular-nums">{moeda(res.totais.geralComJuros)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Atraso c/ juros</div><div className="text-body-lg tabular-nums text-fg-danger">{moeda(res.totais.atrasoComJuros)}</div></div>
            </div>
            <div className="mt-form-gap flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Selecionados</div><div className="text-body-lg tabular-nums">{res.totais.selecionados} de {res.totais.titulos}</div></div>
              <div><div className="text-body-sm text-fg-muted">Valor</div><div className="text-body-lg tabular-nums">{moeda(res.totais.selValor)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Com juros</div><div className="text-body-lg font-semibold tabular-nums">{moeda(res.totais.selComJuros)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Juros</div><div className="text-body-lg tabular-nums">{moeda(res.totais.selJuros)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Descontos</div><div className="text-body-lg tabular-nums">{moeda(res.totais.selDescontos)}</div></div>
            </div>
          </section>
          <DataTable persistId="cons-cli-rcb" savedViewsService={gradeLayoutService}
            rows={res.titulos} columns={cols} getRowId={(t: Titulo) => String(t.codigo)} />
        </>
      )}
    </div>
  );
}
