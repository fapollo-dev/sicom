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

interface Linha { nivel: string; codnivel: number | null; venda: number; custo: number; lucro: number; rentabilidade: number; cupons: number; participacao: number }
interface Resultado { nivel: string; linhas: Linha[]; totais: { venda: number; custo: number; lucro: number; rentabilidade: number; cupons: number } }

/**
 * CONSULTORIA APOLLO (`FRMCONSULTORIAATM`). Dossiê: `uConsultoriaATM.md`.
 *
 * No legado a tela lista os arquivos `at&m_*.fr3` que achar no disco — 15 no cliente, todos sobre a mesma
 * coisa: participação e rentabilidade por nível da árvore de famílias. Aqui o que se escolhe é o **nível**,
 * e o cálculo é um só.
 *
 * A rentabilidade é sobre o CUSTO (é assim no legado), e a barra de participação mostra o peso de cada linha
 * na venda do período — que é o que a tela promete no nome e o layout do legado só desenha no papel.
 */
const NIVEIS = [
  { value: 'DEPARTAMENTO', label: 'Setor / Departamento' },
  { value: 'GRUPO', label: 'Grupo' },
  { value: 'SECAO', label: 'Seção' },
];
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: unknown) => `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

export function ConsultoriaPage() {
  const mensagem = useMensagem();
  const [nivel, setNivel] = useState('DEPARTAMENTO');
  const [dataIni, setDataIni] = useState(inicioMes());
  const [dataFim, setDataFim] = useState(hoje());
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/relatorios/consultoria?nivel=${nivel}&dataIni=${dataIni}&dataFim=${dataFim}`, { headers: apiHeaders() });
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
    const raiz = document.getElementById('cons-impressao');
    if (!raiz) { win.close(); return; }
    imprimirPagina(win, raiz, `Consultoria — ${NIVEIS.find((n) => n.value === nivel)?.label}`, undefined, true);
  };

  const cols = useMemo<DataTableColumnDef<Linha>[]>(() => [
    { field: 'nivel', headerName: NIVEIS.find((n) => n.value === nivel)?.label ?? 'Nível', type: 'text', isPrimary: true },
    { field: 'venda', headerName: 'Venda', type: 'text', width: 140, valueGetter: (l) => moeda(l.venda) },
    { field: 'participacao', headerName: 'Participação', type: 'text', width: 130, valueGetter: (l) => pct(l.participacao) },
    { field: 'custo', headerName: 'Custo', type: 'text', width: 140, valueGetter: (l) => moeda(l.custo) },
    { field: 'lucro', headerName: 'Lucro', type: 'text', width: 140, valueGetter: (l) => moeda(l.lucro) },
    { field: 'rentabilidade', headerName: 'Rentabilidade', type: 'text', width: 140, valueGetter: (l) => pct(l.rentabilidade) },
    { field: 'cupons', headerName: 'Cupons', type: 'text', width: 100 },
  ], [nivel]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Consultoria" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-56"><SelectField label="&Nível" options={NIVEIS} value={nivel} onChange={(v) => setNivel(v ?? 'DEPARTAMENTO')} /></div>
          <div className="w-40"><Field label="&De" type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} /></div>
          <div className="w-40"><Field label="&até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={!res} onClick={imprimir} />
        </div>
        <p className="mt-form-gap text-body-sm text-fg-muted">
          Participação e rentabilidade por nível da árvore de famílias, no período. A rentabilidade é sobre o
          custo, como no sistema antigo. Venda cancelada não entra.
        </p>
      </section>

      {res && (
        <div id="cons-impressao" className="flex flex-col gap-gp-md">
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Venda</div><div className="text-body-lg tabular-nums">{moeda(res.totais.venda)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Custo</div><div className="text-body-lg tabular-nums">{moeda(res.totais.custo)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Lucro</div><div className="text-body-lg tabular-nums">{moeda(res.totais.lucro)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Rentabilidade</div><div className="text-body-lg tabular-nums">{pct(res.totais.rentabilidade)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Cupons</div><div className="text-body-lg tabular-nums">{res.totais.cupons.toLocaleString('pt-BR')}</div></div>
            </div>
          </section>
          <DataTable rows={res.linhas} columns={cols} getRowId={(l: Linha) => String(l.codnivel ?? l.nivel)} />
        </div>
      )}
    </div>
  );
}
