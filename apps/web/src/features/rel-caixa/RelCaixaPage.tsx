import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirPagina } from '../../shared/print/imprimirPagina';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Resultado { modelo: string; linhas: Array<Record<string, unknown>>; totais: Record<string, number> }

/**
 * RELATÓRIOS DE CAIXA (`FRMRELCAIXA`). Dossiê: `uRelCaixa.md`.
 *
 * Cinco modelos no legado; aqui os dois operacionais. As **divergências** são a conferência clássica — o que
 * o PDV registrou contra o que entrou no caixa, por PDV, operador, dia e recurso. Os **caixas abertos** são
 * as sessões que ainda não foram recolhidas.
 *
 * As duas não têm o mesmo escopo, e a tela diz isso: as divergências olham TODO caixa do período, recolhido
 * ou não — o caixa que já foi para a tesouraria continua tendo de fechar.
 */
const MODELOS = [
  { id: 'DIVERGENCIAS', n: 1, label: 'Divergências de caixa', ok: true },
  { id: 'ABERTOS', n: 4, label: 'Caixas abertos', ok: true },
  { id: 'x2', n: 2, label: 'Voucher', nota: 'próximo corte' },
  { id: 'x3', n: 3, label: 'Apuração do caixa', nota: 'próximo corte' },
  { id: 'x5', n: 5, label: 'Relatório de pedidos', nota: 'depende das tabelas de pedido e e-commerce, que ainda não existem no Apollo' },
];
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hora = (v: unknown) => (v == null ? '' : String(v).slice(11, 16));
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

export function RelCaixaPage() {
  const mensagem = useMensagem();
  const [modelo, setModelo] = useState<'DIVERGENCIAS' | 'ABERTOS'>('DIVERGENCIAS');
  const [dataIni, setDataIni] = useState(inicioMes());
  const [dataFim, setDataFim] = useState(hoje());
  const [recurso, setRecurso] = useState('');
  const [soDif, setSoDif] = useState(false);
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ modelo, dataIni, dataFim });
      if (recurso) q.set('recurso', recurso);
      const r = await fetch(`${BASE}/cobranca/rel-caixa?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const imprimir = () => {
    if (!res) return;
    const win = window.open('', '_blank', 'width=1024,height=768');
    if (!win) { mensagem.erro('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
    const raiz = document.getElementById('relcx-impressao');
    if (!raiz) { win.close(); return; }
    const t = MODELOS.find((m) => m.id === modelo)?.label ?? 'Relatório de caixa';
    imprimirPagina(win, raiz, `${t} — ${data(dataIni)} a ${data(dataFim)}`, undefined, modelo === 'DIVERGENCIAS');
  };

  const linhas = useMemo(() => {
    if (!res) return [];
    if (modelo !== 'DIVERGENCIAS' || !soDif) return res.linhas;
    return res.linhas.filter((l) => Math.abs(Number(l.divergencia ?? 0)) >= 0.005);
  }, [res, modelo, soDif]);

  const cols = useMemo<DataTableColumnDef<Record<string, unknown>>[]>(() => (
    modelo === 'DIVERGENCIAS'
      ? [
        { field: 'data', headerName: 'Dia', type: 'text', width: 110, isPrimary: true, valueGetter: (l) => data(l.data) },
        { field: 'codpdv', headerName: 'PDV', type: 'text', width: 70 },
        { field: 'nome', headerName: 'Operador', type: 'text' },
        { field: 'tiporecurso', headerName: 'Recurso', type: 'text', width: 130 },
        { field: 'valor_cx_vendas', headerName: 'O PDV registrou', type: 'text', width: 150, valueGetter: (l) => moeda(l.valor_cx_vendas) },
        { field: 'valor_caixa', headerName: 'Entrou no caixa', type: 'text', width: 150, valueGetter: (l) => moeda(l.valor_caixa) },
        { field: 'divergencia', headerName: 'Diferença', type: 'text', width: 140,
          valueGetter: (l) => (Math.abs(Number(l.divergencia ?? 0)) < 0.005 ? '—' : moeda(l.divergencia)) },
      ]
      : [
        { field: 'data', headerName: 'Dia', type: 'text', width: 110, isPrimary: true, valueGetter: (l) => data(l.data) },
        { field: 'nropdv', headerName: 'PDV', type: 'text', width: 70 },
        { field: 'nome', headerName: 'Operador', type: 'text' },
        { field: 'chave', headerName: 'Sessão', type: 'text', width: 130 },
        { field: 'horaentrada', headerName: 'Entrada', type: 'text', width: 100, valueGetter: (l) => hora(l.horaentrada) },
        { field: 'horasaida', headerName: 'Saída', type: 'text', width: 100, valueGetter: (l) => hora(l.horasaida) },
        { field: 'status', headerName: 'Situação', type: 'text', width: 100 },
      ]
  ), [modelo]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Relatórios de caixa" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="grid grid-cols-1 gap-gp-sm sm:grid-cols-2">
          {MODELOS.map((m) => (
            <label key={m.id} className={`flex cursor-pointer items-start gap-gp-sm rounded-radius-md border p-pad-sm ${modelo === m.id ? 'border-fg-accent bg-bg-subtle' : 'border-border'} ${m.ok ? '' : 'opacity-60'}`}>
              <input type="radio" name="modelocx" className="mt-1" checked={modelo === m.id} disabled={!m.ok}
                onChange={() => m.ok && setModelo(m.id as 'DIVERGENCIAS' | 'ABERTOS')} />
              <span>
                <span className="block text-body-md">{m.n} — {m.label}</span>
                {m.nota && <span className="block text-body-sm text-fg-muted">{m.nota}</span>}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} /></div>
          <div className="w-40"><Field label="&até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></div>
          {modelo === 'DIVERGENCIAS' && (
            <div className="w-44"><SelectField label="&Recurso" options={[{ value: '', label: 'Todos' }, { value: 'DINHEIRO', label: 'Dinheiro' }, { value: 'CARTAO', label: 'Cartão' }, { value: 'CHEQUE', label: 'Cheque' }]}
              value={recurso} onChange={(v) => setRecurso(v ?? '')} /></div>
          )}
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={!res} onClick={imprimir} />
        </div>
        {modelo === 'DIVERGENCIAS' && (
          <label className="mt-form-gap flex items-center gap-gp-sm text-body-sm">
            <input type="checkbox" checked={soDif} onChange={(e) => setSoDif(e.target.checked)} />
            Mostrar só o que não fecha
          </label>
        )}
        <p className="mt-form-gap text-body-sm text-fg-muted">
          {modelo === 'DIVERGENCIAS'
            ? 'Compara o que o PDV registrou com o que entrou no caixa. Desconto, acréscimo, sangria e suprimento ficam de fora — não são recebimento. O caixa já recolhido também entra: ele continua tendo de fechar.'
            : 'As sessões de PDV do período que ainda não foram para a tesouraria.'}
        </p>
      </section>

      {res && (
        <div id="relcx-impressao" className="flex flex-col gap-gp-md">
          {modelo === 'DIVERGENCIAS' && (
            <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
              <div className="flex flex-wrap gap-gp-lg">
                <div><div className="text-body-sm text-fg-muted">O PDV registrou</div><div className="text-body-lg tabular-nums">{moeda(res.totais.pdv)}</div></div>
                <div><div className="text-body-sm text-fg-muted">Entrou no caixa</div><div className="text-body-lg tabular-nums">{moeda(res.totais.caixa)}</div></div>
                <div><div className="text-body-sm text-fg-muted">Diferença</div><div className="text-body-lg tabular-nums">{moeda(res.totais.divergencia)}</div></div>
                <div><div className="text-body-sm text-fg-muted">Linhas que não fecham</div><div className="text-body-lg tabular-nums">{res.totais.comDivergencia} de {res.totais.linhas}</div></div>
              </div>
            </section>
          )}
          <DataTable rows={linhas} columns={cols} getRowId={(_l: Record<string, unknown>, i?: number) => String(i)} />
        </div>
      )}
    </div>
  );
}
