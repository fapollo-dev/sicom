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

interface Linha {
  categoria: string; venda: number; icms_venda: number; piscofins_venda: number; venda_liquida: number;
  custo: number; credito_icms: number; credito_piscofins: number; encargos: number; custo_liquido: number;
  despesa_operacional: number; lucro_bruto: number; ir: number; csll: number; lucro_liquido: number; margem: number;
}
interface Resultado {
  nivel: string; despesaOperacionalUsada: number | null; linhas: Linha[];
  totais: { venda: number; venda_liquida: number; custo_liquido: number; lucro_bruto: number; lucro_liquido: number; margem: number };
}

/**
 * RENTABILIDADE POR CATEGORIAS (`FRMRENTABILIDADECATEGORIAS`). Dossiê: `uRentabilidadeCategorias.md`.
 *
 * A rentabilidade **depois do imposto e da despesa** — a Consultoria para em venda menos custo; esta desce
 * até o lucro líquido. Por isso a tela abre em "Simplificado": a conta cheia tem 15 colunas, e quase sempre
 * o que se quer é venda líquida, custo líquido, lucro e margem. O modo "Completo" mostra cada desconto.
 */
const NIVEIS = [
  { value: 'DEPARTAMENTO', label: 'Departamento' },
  { value: 'GRUPO', label: 'Grupo' },
  { value: 'SUBGRUPO', label: 'Subgrupo' },
];
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: unknown) => `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

export function RentabilidadePage() {
  const mensagem = useMensagem();
  const [nivel, setNivel] = useState('DEPARTAMENTO');
  const [dataIni, setDataIni] = useState(inicioMes());
  const [dataFim, setDataFim] = useState(hoje());
  const [desp, setDesp] = useState('');
  const [completo, setCompleto] = useState(false);
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ nivel, dataIni, dataFim });
      if (desp !== '') q.set('despesaOperacional', desp);
      const r = await fetch(`${BASE}/relatorios/rentabilidade?${q}`, { headers: apiHeaders() });
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
    const base: DataTableColumnDef<Linha>[] = [
      { field: 'categoria', headerName: NIVEIS.find((n) => n.value === nivel)?.label ?? 'Categoria', type: 'text', isPrimary: true },
      { field: 'venda', headerName: 'Venda', type: 'text', width: 130, valueGetter: (l) => moeda(l.venda) },
    ];
    if (completo) {
      base.push(
        { field: 'icms_venda', headerName: '− ICMS', type: 'text', width: 120, valueGetter: (l) => moeda(l.icms_venda) },
        { field: 'piscofins_venda', headerName: '− PIS/COFINS', type: 'text', width: 130, valueGetter: (l) => moeda(l.piscofins_venda) },
      );
    }
    base.push({ field: 'venda_liquida', headerName: 'Venda líquida', type: 'text', width: 140, valueGetter: (l) => moeda(l.venda_liquida) });
    if (completo) {
      base.push(
        { field: 'custo', headerName: 'Custo', type: 'text', width: 120, valueGetter: (l) => moeda(l.custo) },
        { field: 'credito_icms', headerName: '− Créd. ICMS', type: 'text', width: 130, valueGetter: (l) => moeda(l.credito_icms) },
        { field: 'credito_piscofins', headerName: '− Créd. PIS/COFINS', type: 'text', width: 160, valueGetter: (l) => moeda(l.credito_piscofins) },
        { field: 'encargos', headerName: '+ Encargos', type: 'text', width: 130, valueGetter: (l) => moeda(l.encargos) },
      );
    }
    base.push(
      { field: 'custo_liquido', headerName: 'Custo líquido', type: 'text', width: 140, valueGetter: (l) => moeda(l.custo_liquido) },
      { field: 'despesa_operacional', headerName: 'Despesa oper.', type: 'text', width: 140, valueGetter: (l) => moeda(l.despesa_operacional) },
      { field: 'lucro_bruto', headerName: 'Lucro bruto', type: 'text', width: 140, valueGetter: (l) => moeda(l.lucro_bruto) },
    );
    if (completo) {
      base.push(
        { field: 'ir', headerName: '− IR', type: 'text', width: 110, valueGetter: (l) => moeda(l.ir) },
        { field: 'csll', headerName: '− CSLL', type: 'text', width: 110, valueGetter: (l) => moeda(l.csll) },
      );
    }
    base.push(
      { field: 'lucro_liquido', headerName: 'Lucro líquido', type: 'text', width: 145, valueGetter: (l) => moeda(l.lucro_liquido) },
      { field: 'margem', headerName: 'Margem', type: 'text', width: 110, valueGetter: (l) => pct(l.margem) },
    );
    return base;
  }, [nivel, completo]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Rentabilidade por categorias" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-48"><SelectField label="&Nível" options={NIVEIS} value={nivel} onChange={(v) => setNivel(v ?? 'DEPARTAMENTO')} /></div>
          <div className="w-40"><Field label="&De" type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} /></div>
          <div className="w-40"><Field label="&até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></div>
          <div className="w-44"><Field label="Despesa operacional (%)" value={desp} onChange={(e) => setDesp(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))} placeholder="a da empresa" /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            const win = window.open('', '_blank', 'width=1024,height=768');
            if (!win) { mensagem.erro('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
            const raiz = document.getElementById('rent-impressao');
            if (!raiz) { win.close(); return; }
            imprimirPagina(win, raiz, 'Rentabilidade por categorias', undefined, true);
          }} />
        </div>
        <label className="mt-form-gap flex items-center gap-gp-sm text-body-sm">
          <input type="checkbox" checked={completo} onChange={(e) => setCompleto(e.target.checked)} />
          Mostrar a conta completa <span className="text-fg-muted">(cada imposto, crédito e encargo em coluna própria)</span>
        </label>
        <p className="mt-form-gap text-body-sm text-fg-muted">
          Desconta da venda o ICMS e o PIS/COFINS; do custo, os créditos, mais os encargos de compra (ICMS-ST,
          frete, seguro, IPI). Depois a despesa operacional, o IR e a CSLL. Em branco, a despesa é a cadastrada
          na empresa.
        </p>
      </section>

      {res && (
        <div id="rent-impressao" className="flex flex-col gap-gp-md">
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Venda</div><div className="text-body-lg tabular-nums">{moeda(res.totais.venda)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Venda líquida</div><div className="text-body-lg tabular-nums">{moeda(res.totais.venda_liquida)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Custo líquido</div><div className="text-body-lg tabular-nums">{moeda(res.totais.custo_liquido)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Lucro bruto</div><div className="text-body-lg tabular-nums">{moeda(res.totais.lucro_bruto)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Lucro líquido</div><div className="text-body-lg tabular-nums">{moeda(res.totais.lucro_liquido)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Margem</div><div className="text-body-lg tabular-nums">{pct(res.totais.margem)}</div></div>
            </div>
          </section>
          <DataTable rows={res.linhas} columns={cols} getRowId={(_l: Linha, i?: number) => String(i)} />
        </div>
      )}
    </div>
  );
}
