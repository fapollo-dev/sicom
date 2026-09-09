import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirPagina } from '../../shared/print/imprimirPagina';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Linha {
  operadora: string | null; administradora: string | null; diascomp: number; txadm: number;
  valor: number; valor_liquido: number; credito: number; debito: number; alimentacao: number;
}
interface Resultado { linhas: Linha[]; totais: { valor: number; valor_liquido: number; taxa: number; credito: number; debito: number; alimentacao: number } }

/**
 * TOTAL POR CARTÃO (`FRMRELCARTOES`). Dossiê: `uRelCartoes.md`.
 *
 * O bruto e o líquido da taxa por operadora, com a separação crédito / débito / alimentação. O número que a
 * tela existe para dar é **o que a operadora fica** — a diferença entre o que se vendeu e o que se recebe.
 */
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: unknown) => `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const data = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

export function RelCartoesPage() {
  const mensagem = useMensagem();
  const [dataIni, setDataIni] = useState(inicioMes());
  const [dataFim, setDataFim] = useState(hoje());
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/relatorios/cartoes?dataIni=${dataIni}&dataFim=${dataFim}`, { headers: apiHeaders() });
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
    const raiz = document.getElementById('cart-impressao');
    if (!raiz) { win.close(); return; }
    imprimirPagina(win, raiz, `Total por cartão — ${data(dataIni)} a ${data(dataFim)}`, undefined, true);
  };

  const cols = useMemo<DataTableColumnDef<Linha>[]>(() => [
    { field: 'operadora', headerName: 'Operadora', type: 'text', isPrimary: true },
    { field: 'administradora', headerName: 'Administradora', type: 'text', width: 180 },
    { field: 'txadm', headerName: 'Taxa', type: 'text', width: 90, valueGetter: (l) => pct(l.txadm) },
    { field: 'diascomp', headerName: 'Compensa em', type: 'text', width: 120, valueGetter: (l) => `${l.diascomp} dia(s)` },
    { field: 'valor', headerName: 'Bruto', type: 'text', width: 140, valueGetter: (l) => moeda(l.valor) },
    { field: 'valor_liquido', headerName: 'Líquido', type: 'text', width: 140, valueGetter: (l) => moeda(l.valor_liquido) },
    { field: 'credito', headerName: 'Crédito', type: 'text', width: 130, valueGetter: (l) => moeda(l.credito) },
    { field: 'debito', headerName: 'Débito', type: 'text', width: 130, valueGetter: (l) => moeda(l.debito) },
    { field: 'alimentacao', headerName: 'Alimentação', type: 'text', width: 130, valueGetter: (l) => moeda(l.alimentacao) },
  ], []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Total por cartão" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="Venda &de" type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} /></div>
          <div className="w-40"><Field label="&até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={!res} onClick={imprimir} />
        </div>
        <p className="mt-form-gap text-body-sm text-fg-muted">
          Pela data da venda, com ou sem baixa. O que não é crédito nem débito entra como alimentação — é assim
          que o sistema antigo separa.
        </p>
      </section>

      {res && (
        <div id="cart-impressao" className="flex flex-col gap-gp-md">
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Vendido</div><div className="text-body-lg tabular-nums">{moeda(res.totais.valor)}</div></div>
              <div><div className="text-body-sm text-fg-muted">A receber (líquido)</div><div className="text-body-lg tabular-nums">{moeda(res.totais.valor_liquido)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Fica com a operadora</div><div className="text-body-lg tabular-nums">{moeda(res.totais.taxa)}</div></div>
            </div>
            <div className="mt-form-gap flex flex-wrap gap-gp-lg border-t border-border pt-form-gap">
              <div><div className="text-body-sm text-fg-muted">Crédito</div><div className="tabular-nums">{moeda(res.totais.credito)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Débito</div><div className="tabular-nums">{moeda(res.totais.debito)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Alimentação</div><div className="tabular-nums">{moeda(res.totais.alimentacao)}</div></div>
            </div>
          </section>
          <DataTable rows={res.linhas} columns={cols} getRowId={(_l: Linha, i?: number) => String(i)} />
        </div>
      )}
    </div>
  );
}
