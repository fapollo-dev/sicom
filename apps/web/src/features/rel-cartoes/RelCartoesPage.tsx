import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { hojeNaLoja } from '../../shared/tempo';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Linha {
  idempresa: number;
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
const hoje = () => hojeNaLoja();
const inicioMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

export function RelCartoesPage() {
  const mensagem = useMensagem();
  const [dataIni, setDataIni] = useState(inicioMes());
  const [dataFim, setDataFim] = useState(hoje());
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // o edtOperadora do legado: o texto e o modo do SetaFiltro; as lojas do GetMultiEmpresa
  const [operadora, setOperadora] = useState('');
  const [modoOperadora, setModoOperadora] = useState('contem');
  const [empresas, setEmpresas] = useState('');
  const consulta = () => {
    const q = new URLSearchParams({ dataIni, dataFim });
    if (operadora.trim()) { q.set('operadora', operadora.trim()); q.set('modoOperadora', modoOperadora); }
    if (empresas.trim()) q.set('empresas', empresas.replace(/\s/g, ''));
    return q.toString();
  };

  const gerar = async () => {
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/relatorios/cartoes?${consulta()}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  // o "Imprimir" no layout do cliente (Rel_Total_Cartao.fr3, agrupado por loja)
  const imprimir = () => { imprimirRelatorio(`/relatorios/cartoes/impressao?${consulta()}`).catch((e) => mensagem.erro(e)); };

  const cols = useMemo<DataTableColumnDef<Linha>[]>(() => [
    { field: 'idempresa', headerName: 'Loja', type: 'text', width: 70 },
    { field: 'operadora', headerName: 'Operadora', type: 'text', isPrimary: true },
    { field: 'administradora', headerName: 'Administradora', type: 'text', width: 180 },
    { field: 'txadm', headerName: 'Taxa', type: 'text', width: 90, valueGetter: (l) => (l.txadm == null ? '' : pct(l.txadm)) },
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
          <div className="w-40"><Field label="até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></div>
          <div className="w-44"><Field label="Operadora" value={operadora} onChange={(e) => setOperadora(e.target.value.toUpperCase())} /></div>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Filtro
            <select className="rounded border border-border px-1 py-1" value={modoOperadora} onChange={(e) => setModoOperadora(e.target.value)}>
              <option value="igual">Igual a</option>
              <option value="comeca">Começa com</option>
              <option value="termina">Termina com</option>
              <option value="contem">Contém</option>
              <option value="diferente">Diferente de</option>
            </select>
          </label>
          <div className="w-32"><Field label="&Empresas (1,2)" value={empresas} onChange={(e) => setEmpresas(e.target.value)} placeholder="esta loja" /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={ocupado} onClick={imprimir} />
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
