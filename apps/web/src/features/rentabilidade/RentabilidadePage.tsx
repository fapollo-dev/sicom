import { useMemo, useState } from 'react';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { hojeNaLoja } from '../../shared/tempo';
import { useShortcut } from '../../shared/keyboard';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Linha = Record<string, unknown>;
interface Resultado { empresas: number[]; linhas: Linha[] }

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: unknown) => `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const inicioMes = () => `${hojeNaLoja().slice(0, 8)}01`;
const MODOS: Array<[string, string]> = [['contem', 'Contém'], ['igual', 'Igual a'], ['comeca', 'Começa com'], ['termina', 'Termina com'], ['diferente', 'Diferente de']];

/**
 * RENTABILIDADE POR CATEGORIAS (`FRMRENTABILIDADECATEGORIAS`). Dossiê: `uRentabilidadeCategorias.md`.
 *
 * O relatório do legado: por subgrupo × produto, da venda ao lucro final (ICMS e PIS/COFINS de entrada e saída, ST, frete, IPI, a
 * despesa operacional, a perda, IR e CSLL), com o índice do subgrupo no ranking e a participação do produto no lucro dele. Imprime
 * completo, simplificado ou só os totais, nos layouts do cliente.
 */
export function RentabilidadePage() {
  const { tem: pode } = useOpcoesDoForm('FRMRENTABILIDADECATEGORIAS'); // o "Consultar" (btnConsulta, Tag 1) — permissões de controle
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: inicioMes(), dataFim: hojeNaLoja(), despesaOperacional: '', empresas: '',
    dpto: '', modoDpto: 'contem', grupo: '', modoGrupo: 'contem', subgrupo: '', modoSubgrupo: 'contem', codfor: '',
    somenteScrapImportado: false, considerarNf: false, tipo: 'COMPLETO',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const consulta = () => {
    const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim, tipo: f.tipo });
    if (f.despesaOperacional.trim()) q.set('despesaOperacional', f.despesaOperacional.replace(',', '.'));
    if (f.empresas.trim()) q.set('empresas', f.empresas.replace(/\s/g, ''));
    for (const [k, m] of [['dpto', 'modoDpto'], ['grupo', 'modoGrupo'], ['subgrupo', 'modoSubgrupo']] as const) {
      if (f[k].trim()) { q.set(k, f[k].trim().toUpperCase()); q.set(m, f[m]); }
    }
    if (f.codfor.trim()) q.set('codfor', f.codfor.trim());
    if (f.somenteScrapImportado) q.set('somenteScrapImportado', 'true');
    if (f.considerarNf) q.set('considerarNf', 'true');
    return q.toString();
  };

  const gerar = async () => {
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/relatorios/rentabilidade/legado?${consulta()}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      const j = (await r.json()) as Resultado;
      setRes({ ...j, linhas: j.linhas.map((l, k) => ({ ...l, _k: k })) });
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  // o "Imprimir" no layout do tipo (completo / simplificado / totais)
  const imprimir = () => { imprimirRelatorio(`/relatorios/rentabilidade/impressao?${consulta()}`).catch((e) => mensagem.erro(e)); };
  // F9 = btnConsultaClick (FormKeyDown do uRentabilidadeCategorias; "[F9] Consultar") — com o Consultar habilitado (permissão de controle)
  useShortcut('f9', () => { void gerar(); }, { when: !ocupado && pode('BTNCONSULTA') });

  const cols = useMemo<DataTableColumnDef<Linha>[]>(() => {
    const t = (field: string, headerName: string, width: number, fmt?: (v: unknown) => string): DataTableColumnDef<Linha> =>
      ({ field, headerName, type: 'text', width, valueGetter: (l: Linha) => (fmt ? fmt(l[field]) : String(l[field] ?? '')) });
    return [
      t('subgrupo', 'Subgrupo', 160), t('indice', 'Índice', 70), { ...t('descricao', 'Produto', 220), isPrimary: true }, t('totqtde', 'Qtde', 80, moeda),
      t('totvenda', 'Venda', 110, moeda), t('totcusto', 'Custo', 110, moeda), t('debitoicms', 'ICMS saída', 100, moeda), t('creditoicms', 'ICMS entrada', 100, moeda),
      t('piscofins', 'PIS/COFINS', 100, moeda), t('adicionaiscusto', 'Adicionais', 100, moeda), t('vendaliquida', 'Venda líquida', 120, moeda),
      t('vrcustoreal', 'Custo real', 110, moeda), t('lucro', 'Lucro', 110, moeda), t('margembruta', 'Margem bruta', 110, pct), t('despoperacional', 'Desp. oper.', 100, moeda),
      t('vrperda', 'Perda', 90, moeda), t('lucroliq', 'Lucro líquido', 120, moeda), t('imprenda', 'IR', 90, moeda), t('contsocial', 'CSLL', 90, moeda),
      t('lucrofinal', 'Lucro final', 120, moeda), t('margemfinal', 'Margem final', 110, pct), t('participacao', 'Partic.', 90, pct), t('acumulado', 'Acumulado', 100, pct),
    ];
  }, []);

  const Modo = ({ k }: { k: 'modoDpto' | 'modoGrupo' | 'modoSubgrupo' }) => (
    <select className="rounded border border-border px-1 py-1 text-body-sm" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
      {MODOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Rentabilidade por categorias" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-36"><Field label="Desp. &operacional %" value={f.despesaOperacional} onChange={(e) => setF({ ...f, despesaOperacional: e.target.value })} placeholder="da empresa" /></div>
          <div className="w-32"><Field label="&Empresas (1,2)" value={f.empresas} onChange={(e) => setF({ ...f, empresas: e.target.value })} placeholder="esta loja" /></div>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Tipo
            <select className="rounded border border-border px-1 py-1" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              <option value="COMPLETO">Completo</option>
              <option value="SIMPLIFICADO">Simplificado</option>
              <option value="TOTAIS">Totais</option>
            </select>
          </label>
          <Button label="&Consultar" disabled={ocupado || !pode('BTNCONSULTA')} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={ocupado || !pode('BTNCONSULTA')} onClick={imprimir} />
        </div>
        <div className="mt-form-gap flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="De&partamento" value={f.dpto} onChange={(e) => setF({ ...f, dpto: e.target.value })} /></div><Modo k="modoDpto" />
          <div className="w-40"><Field label="&Grupo" value={f.grupo} onChange={(e) => setF({ ...f, grupo: e.target.value })} /></div><Modo k="modoGrupo" />
          <div className="w-40"><Field label="&Subgrupo" value={f.subgrupo} onChange={(e) => setF({ ...f, subgrupo: e.target.value })} /></div><Modo k="modoSubgrupo" />
          <div className="w-32"><Field label="&Fornecedor" value={f.codfor} onChange={(e) => setF({ ...f, codfor: e.target.value })} /></div>
        </div>
        <div className="mt-form-gap flex flex-wrap items-center gap-gp-lg text-body-sm">
          <label className="flex items-center gap-gp-xs"><input type="checkbox" checked={f.considerarNf} onChange={(e) => setF({ ...f, considerarNf: e.target.checked })} /> Considerar as notas de saída</label>
          <label className="flex items-center gap-gp-xs"><input type="checkbox" checked={f.somenteScrapImportado} onChange={(e) => setF({ ...f, somenteScrapImportado: e.target.checked })} /> Perda só dos scraps importados</label>
          <span className="text-fg-muted">O fornecedor substitui os filtros de família (como no sistema antigo).</span>
        </div>
      </section>
      {res && (
        <DataTable persistId="rentabilidade-legado" rows={res.linhas} columns={cols} getRowId={(l: Linha) => String(l._k)} />
      )}
    </div>
  );
}
