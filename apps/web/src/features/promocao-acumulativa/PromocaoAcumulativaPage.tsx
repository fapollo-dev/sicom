import { useEffect, useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Promo {
  idproacumulativa: number; idproduto: number; descricao: string; codbarra: string;
  qtde: number; desconto: number; idempresa: string; dtini: string; dtfim: string;
  atacarejo: string; codgrupopreco: number; grupo_preco: string | null; vigente: boolean;
}

/**
 * PROMOÇÃO ACUMULATIVA (`FRMCADPROMOCAOACUMULATIVA`). Dossiê: `uCadPromocaoAcumulativa.md`.
 *
 * "Leve N, pague menos": o cliente acumula uma quantidade do produto no cupom e o preço cai. Aqui é só o
 * cadastro da regra — quem a aplica é o PDV.
 *
 * A promoção vale para **várias lojas** ao mesmo tempo, e o sistema recusa cadastrar o mesmo produto (ou o
 * mesmo grupo de preço) em duas promoções cujos períodos se cruzem numa loja em comum.
 */
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown, d = 3) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });
const dataHora = (v: unknown) => {
  if (!v) return '';
  const s = String(v).replace('T', ' ');
  const [d, h = ''] = s.split(' ');
  return `${d.split('-').reverse().join('/')} ${h.slice(0, 5)}`.trim();
};
const agora = () => new Date().toISOString().slice(0, 16);
const emDias = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 16);
/** `;1;2;` → [1, 2] */
const lojasDe = (s: string) => (s ?? '').split(';').map((x) => x.trim()).filter(Boolean);

const VAZIO = {
  idproacumulativa: null as number | null, idproduto: '', qtde: '', desconto: '',
  dtini: agora(), dtfim: emDias(7), atacarejo: false, usarGrupoPreco: false,
};

export function PromocaoAcumulativaPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<Promo[]>([]);
  const [filtro, setFiltro] = useState({ descricao: '', vigentes: false });
  const [form, setForm] = useState({ ...VAZIO });
  const [empresas, setEmpresas] = useState<number[]>([]);
  const [ocupado, setOcupado] = useState(false);

  const { data: empresaOptions = [] } = useResourceOptions('cadastro/empresas', (e: any) => ({
    value: String(e.idempresa ?? e.codempresa), label: `${e.idempresa ?? e.codempresa} - ${e.fantasia ?? e.razao_social ?? ''}`,
  }));

  const chamar = async (url: string, init?: RequestInit) => {
    const r = await fetch(`${BASE}/${url}`, { ...init, headers: apiHeaders() });
    handle401(r);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
      throw Object.assign(new Error(env.code), { envelope: env });
    }
    return r.json();
  };

  const carregar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      if (filtro.descricao) q.set('descricao', filtro.descricao);
      if (filtro.vigentes) q.set('vigentes', 'true');
      setLista((await chamar(`cadastro/promocao-acumulativa?${q}`)) as Promo[]);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  useEffect(() => { void carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const gravar = async () => {
    setOcupado(true);
    try {
      await chamar('cadastro/promocao-acumulativa', {
        method: 'POST',
        body: JSON.stringify({
          idproacumulativa: form.idproacumulativa,
          idproduto: Number(form.idproduto), qtde: Number(form.qtde), desconto: Number(form.desconto),
          dtini: form.dtini, dtfim: form.dtfim, empresas,
          atacarejo: form.atacarejo ? 'S' : 'N', usarGrupoPreco: form.usarGrupoPreco,
        }),
      });
      mensagem.sucesso(form.idproacumulativa ? 'Promoção alterada.' : 'Promoção cadastrada.');
      setForm({ ...VAZIO }); setEmpresas([]);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const editar = (p: Promo) => {
    setForm({
      idproacumulativa: p.idproacumulativa, idproduto: String(p.idproduto),
      qtde: String(p.qtde), desconto: String(p.desconto),
      dtini: String(p.dtini).replace(' ', 'T').slice(0, 16),
      dtfim: String(p.dtfim).replace(' ', 'T').slice(0, 16),
      atacarejo: p.atacarejo === 'S', usarGrupoPreco: Number(p.codgrupopreco) > 0,
    });
    setEmpresas(lojasDe(p.idempresa).map(Number));
  };

  const excluir = async (p: Promo) => {
    if (!window.confirm(`Excluir a promoção ${p.idproacumulativa} de ${p.descricao}?`)) return;
    setOcupado(true);
    try {
      await chamar(`cadastro/promocao-acumulativa/${p.idproacumulativa}`, { method: 'DELETE' });
      mensagem.sucesso('Promoção excluída.');
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const cols = useMemo<DataTableColumnDef<Promo>[]>(() => [
    { field: 'idproacumulativa', headerName: 'Código', type: 'text', width: 90, isPrimary: true },
    { field: 'descricao', headerName: 'Produto', type: 'text' },
    { field: 'qtde', headerName: 'Leve', type: 'text', width: 90, valueGetter: (p) => nfmt(p.qtde) },
    { field: 'desconto', headerName: 'Desconto', type: 'text', width: 120, valueGetter: (p) => moeda(p.desconto) },
    { field: 'dtini', headerName: 'Início', type: 'text', width: 145, valueGetter: (p) => dataHora(p.dtini) },
    { field: 'dtfim', headerName: 'Término', type: 'text', width: 145, valueGetter: (p) => dataHora(p.dtfim) },
    { field: 'idempresa', headerName: 'Lojas', type: 'text', width: 110, valueGetter: (p) => lojasDe(p.idempresa).join(', ') },
    { field: 'grupo_preco', headerName: 'Grupo de preço', type: 'text', width: 160, valueGetter: (p) => (Number(p.codgrupopreco) > 0 ? p.grupo_preco ?? String(p.codgrupopreco) : '—') },
    { field: 'atacarejo', headerName: 'Atacarejo', type: 'text', width: 100, valueGetter: (p) => (p.atacarejo === 'S' ? 'Sim' : 'Não') },
    { field: 'vigente', headerName: 'Situação', type: 'text', width: 110, valueGetter: (p) => (p.vigente ? 'Vigente' : 'Fora do período') },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 110,
      // ⚠️ a coluna de ações só desenha o botão quando há `icon` — sem ele a tela vira somente-leitura
      // em silêncio. Lição de 08/09, e vale para toda coluna nova de ação.
      getActions: ({ row: p }: { row: Promo }) => [
        { id: 'ed', label: 'Editar', icon: <Pencil size={16} />, onClick: () => editar(p) },
        { id: 'ex', label: 'Excluir', icon: <Trash2 size={16} />, destructive: true, onClick: () => void excluir(p) },
      ],
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [lista]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Promoção acumulativa" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          <strong>Leve N, pague menos.</strong> O cliente acumula a quantidade do produto no mesmo cupom e o
          preço cai o valor do desconto. Quem aplica a regra é o PDV; aqui ela é cadastrada.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-32"><Field label="&Produto (código)" value={form.idproduto} onChange={(e) => setForm({ ...form, idproduto: e.target.value })} /></div>
          <div className="w-28"><Field label="&Quantidade" value={form.qtde} onChange={(e) => setForm({ ...form, qtde: e.target.value })} /></div>
          <div className="w-32"><Field label="&Desconto" value={form.desconto} onChange={(e) => setForm({ ...form, desconto: e.target.value })} /></div>
          <div className="w-52"><Field label="&Início (data e hora)" type="datetime-local" value={form.dtini} onChange={(e) => setForm({ ...form, dtini: e.target.value })} /></div>
          <div className="w-52"><Field label="&Término (data e hora)" type="datetime-local" value={form.dtfim} onChange={(e) => setForm({ ...form, dtfim: e.target.value })} /></div>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Lojas
            <select multiple size={1} className="rounded border border-border px-1 py-1"
              value={empresas.map(String)}
              onChange={(e) => setEmpresas(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}>
              {empresaOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-form-gap flex flex-wrap items-center gap-gp-md text-body-sm">
          <label className="flex items-center gap-gp-sm">
            <input type="checkbox" checked={form.atacarejo} onChange={(e) => setForm({ ...form, atacarejo: e.target.checked })} />
            Atacarejo
          </label>
          <label className="flex items-center gap-gp-sm">
            <input type="checkbox" checked={form.usarGrupoPreco} onChange={(e) => setForm({ ...form, usarGrupoPreco: e.target.checked })} />
            Vale para o <strong>grupo de preço</strong> do produto
            <span className="text-fg-muted">(e não só para ele)</span>
          </label>
          <Button label={form.idproacumulativa ? '&Alterar' : '&Gravar'} disabled={ocupado} onClick={() => void gravar()} />
          {form.idproacumulativa != null && (
            <Button label="&Cancelar edição" variant="soft" onClick={() => { setForm({ ...VAZIO }); setEmpresas([]); }} />
          )}
        </div>
      </section>

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-64"><Field label="Filtrar por &descrição" value={filtro.descricao} onChange={(e) => setFiltro({ ...filtro, descricao: e.target.value })} /></div>
          <label className="flex items-center gap-gp-sm text-body-sm">
            <input type="checkbox" checked={filtro.vigentes} onChange={(e) => setFiltro({ ...filtro, vigentes: e.target.checked })} />
            Só as vigentes
          </label>
          <Button label="&Buscar" disabled={ocupado} onClick={() => void carregar()} />
        </div>
      </section>

      <DataTable rows={lista} columns={cols} getRowId={(p: Promo) => String(p.idproacumulativa)} />
    </div>
  );
}
