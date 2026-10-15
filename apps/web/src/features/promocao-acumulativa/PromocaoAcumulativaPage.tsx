import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { useShortcut } from '../../shared/keyboard';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';
import { RegistrosLogModal } from '../../shared/log/RegistrosLogModal';
import { hojeNaLoja } from '../../shared/tempo';

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
/** `;1;2;` → [1, 2] */
const lojasDe = (s: string) => (s ?? '').split(';').map((x) => x.trim()).filter(Boolean);

// btnAdicionarRegistroClick: hoje, das 05:00 às 23:59, sem "Grupo Preço"; o produto mostra código de barras, descrição e o grupo de preço
const novo = () => ({
  idproacumulativa: null as number | null, idproduto: '', qtde: '', desconto: '',
  dtini: `${hojeNaLoja()}T05:00`, dtfim: `${hojeNaLoja()}T23:59`, atacarejo: false, usarGrupoPreco: false,
  codbarra: '', descricao: '', cod_grupopreco: 0, grupo_preco: '',
});

export function PromocaoAcumulativaPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<Promo[]>([]);
  const [filtro, setFiltro] = useState({ descricao: '', situacao: 'TODAS' });
  /** a grade `dbgPromocao`: os produtos do grupo de preço do produto em edição. */
  const [doGrupo, setDoGrupo] = useState<Array<Record<string, any>>>([]);
  const [form, setForm] = useState(novo);
  const [empresas, setEmpresas] = useState<number[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [pesqProduto, setPesqProduto] = useState(false);
  const [historico, setHistorico] = useState(false);
  // F3 = ChamaTelaOpcoes (FormKeyUp do uCadPromocaoAcumulativa): "Trazer somente abertas / somente fechadas / todas" antes da
  // Pesquisa — aqui é o combo Situação do filtro, ao lado do Buscar (a tela não tem o edtCodigo do cadastro)
  const situacaoRef = useRef<HTMLSelectElement>(null);
  useShortcut('f3', () => situacaoRef.current?.focus());

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
      if (filtro.situacao) q.set('situacao', filtro.situacao);
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
      setForm(novo()); setEmpresas([]);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  /**
   * O exit do Produto (`edtCodProdExit` → `VerificarProdutoAtivo`): o produto ATIVO mostra código de barras, descrição e grupo de preço; o
   * que não existe avisa "Produto nao encontrado!" e limpa. Sem grupo de preço, o "Grupo Preço" fica travado e desmarcado.
   */
  const verificarProduto = async (codigo: string) => {
    if (!codigo.trim()) { setForm((x) => ({ ...x, idproduto: '', codbarra: '', descricao: '', cod_grupopreco: 0, grupo_preco: '', usarGrupoPreco: false })); return; }
    try {
      const p = (await chamar(`cadastro/promocao-acumulativa/produto/${encodeURIComponent(codigo.trim())}`)) as { idproduto: number; codbarra: string | null; descricao: string | null; cod_grupopreco: number; grupo_preco: string | null };
      setForm((x) => ({ ...x, idproduto: String(p.idproduto), codbarra: p.codbarra ?? '', descricao: p.descricao ?? '', cod_grupopreco: Number(p.cod_grupopreco ?? 0),
        grupo_preco: p.grupo_preco ?? '', usarGrupoPreco: Number(p.cod_grupopreco ?? 0) > 0 ? x.usarGrupoPreco : false }));
    } catch (e) {
      setForm((x) => ({ ...x, idproduto: '', codbarra: '', descricao: '', cod_grupopreco: 0, grupo_preco: '', usarGrupoPreco: false }));
      mensagem.erro(e);
    }
  };
  const editar = (p: Promo) => {
    setForm({
      ...novo(),
      idproacumulativa: p.idproacumulativa, idproduto: String(p.idproduto),
      qtde: String(p.qtde), desconto: String(p.desconto),
      dtini: String(p.dtini).replace(' ', 'T').slice(0, 16),
      dtfim: String(p.dtfim).replace(' ', 'T').slice(0, 16),
      atacarejo: p.atacarejo === 'S', usarGrupoPreco: Number(p.codgrupopreco) > 0,
      codbarra: p.codbarra ?? '', descricao: p.descricao ?? '',
    });
    setEmpresas(lojasDe(p.idempresa).map(Number));
    void verificarProduto(String(p.idproduto));
    void verGrupo(p.idproduto);
  };

  const excluir = async (p: Promo) => {
    if (!window.confirm(`Excluir a promoção ${p.idproacumulativa} de ${p.descricao}?`)) return;
    // ⚠️ o legado pede SENHA ADMINISTRATIVA antes de excluir (`btnExcluirClick:130`) — apagar a promoção
    // some com o desconto que a loja está anunciando.
    const senha = window.prompt('Senha administrativa para excluir a promoção:');
    if (!senha) return;
    setOcupado(true);
    try {
      await chamar(`cadastro/promocao-acumulativa/${p.idproacumulativa}?senhaOperacao=${encodeURIComponent(senha)}`, { method: 'DELETE' });
      mensagem.sucesso('Promoção excluída.');
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  /**
   * O OUTRO excluir (`btnExcluirPromocaoClick:156`): encerra a promoção dos produtos do grupo de preço.
   *
   * O legado faz `DELETE ... WHERE IDPRODUTO = <cada um da grade>`, sem filtro de data nem de loja. Aqui o
   * alcance é o que o operador realmente quis: **a loja dele** e o que **ainda vale**. Promoção
   * compartilhada com outra loja perde só esta loja da lista; promoção já encerrada fica no histórico.
   */
  const excluirGrupo = async () => {
    const cod = Number(doGrupo[0]?.codgrupopreco ?? 0);
    if (!(cod > 0)) return;
    const comPromo = doGrupo.filter((x) => x.idproacumulativa != null).length;
    if (!window.confirm(
      `Encerrar a promoção dos produtos do grupo de preço ${cod} NESTA LOJA?\n\n`
      + `${comPromo} promoção(ões) listada(s). Serão retiradas apenas as desta loja e que ainda valem — `
      + 'as de outras lojas continuam, e as já encerradas ficam no histórico.')) return;
    const senha = window.prompt('Senha administrativa para excluir as promoções do grupo:');
    if (!senha) return;
    setOcupado(true);
    try {
      const r = (await chamar(`cadastro/promocao-acumulativa/grupo/${cod}?senhaOperacao=${encodeURIComponent(senha)}`, { method: 'DELETE' })) as any;
      const partes = [`${r.excluidas} promoção(ões) excluída(s)`];
      if (r.lojaRemovida > 0) partes.push(`${r.lojaRemovida} mantida(s) para as outras lojas`);
      if (r.preservadasHistoricas > 0) partes.push(`${r.preservadasHistoricas} já encerrada(s), preservada(s) no histórico`);
      mensagem.sucesso(`${partes.join(' · ')}.`);
      setDoGrupo([]);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  /** ao escolher um produto com grupo de preço, a tela mostra o grupo inteiro — como a grade do legado. */
  const verGrupo = async (idproduto: number) => {
    try {
      const p = lista.find((x) => x.idproduto === idproduto);
      const cod = Number(p?.codgrupopreco ?? 0);
      if (!(cod > 0)) { setDoGrupo([]); return; }
      setDoGrupo((await chamar(`cadastro/promocao-acumulativa/grupo/${cod}`)) as Array<Record<string, any>>);
    } catch (e) { mensagem.erro(e); }
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
          {/* edtCodProd + btnBuscaProduto: o código, o [F3]/… (a GET_PRODUTOS ativos por descrição) e o que o exit mostra */}
          <div className="flex items-end gap-gp-xs">
            <div className="w-32"><Field label="&Produto" value={form.idproduto} onChange={(e) => setForm({ ...form, idproduto: e.target.value })}
              onBlur={(e) => void verificarProduto(e.target.value)} onKeyDown={(e) => { if (e.key === 'F3') { e.preventDefault(); setPesqProduto(true); } }} /></div>
            <Button label="…" variant="soft" onClick={() => setPesqProduto(true)} />
          </div>
          <div className="w-40"><Field label="Código de barra" value={form.codbarra} readOnly disabled /></div>
          <div className="w-64"><Field label="Descrição" value={form.descricao} readOnly disabled /></div>
          <div className="w-28"><Field label="Quantidade" value={form.qtde} onChange={(e) => setForm({ ...form, qtde: e.target.value })} /></div>
          <div className="w-32"><Field label="Desconto" value={form.desconto} onChange={(e) => setForm({ ...form, desconto: e.target.value })} /></div>
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
          {/* chkGrupoPreco: só com o produto num grupo de preço (dtsPrincipalDataChange); marcado, a promoção vale para o grupo (CODGRUPOPRECO) */}
          <label className="flex items-center gap-gp-sm">
            <input type="checkbox" disabled={!(form.cod_grupopreco > 0)} checked={form.usarGrupoPreco} onChange={(e) => setForm({ ...form, usarGrupoPreco: e.target.checked })} />
            Grupo Preço
          </label>
          <div className="w-28"><Field label="Grupo de Preço" value={form.cod_grupopreco > 0 ? String(form.cod_grupopreco) : ''} readOnly disabled /></div>
          <div className="w-56"><Field label="Descrição do Grupo de Preço" value={form.grupo_preco} readOnly disabled /></div>
          <Button label={form.idproacumulativa ? '&Alterar' : '&Gravar'} disabled={ocupado} onClick={() => void gravar()} />
          {form.idproacumulativa != null && (
            <Button label="&Cancelar edição" variant="soft" onClick={() => { setForm(novo()); setEmpresas([]); }} />
          )}
        </div>
      </section>

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-64"><Field label="Filtrar por &descrição" value={filtro.descricao} onChange={(e) => setFiltro({ ...filtro, descricao: e.target.value })} /></div>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Situação
            <select ref={situacaoRef} className="rounded border border-border px-1 py-1" value={filtro.situacao}
              onChange={(e) => setFiltro({ ...filtro, situacao: e.target.value })}>
              <option value="ABERTAS">Somente abertas</option>
              <option value="FECHADAS">Somente fechadas</option>
              <option value="TODAS">Todas</option>
            </select>
          </label>
          <span className="text-body-sm text-fg-muted">
            &quot;Aberta&quot; é término a partir de hoje — inclui a que ainda não começou.
          </span>
          <Button label="&Buscar" disabled={ocupado} onClick={() => void carregar()} />
          {/* BtnHistorico: os registros de log das promoções EXCLUÍDAS (ChamaTelaRegistrosLog('IDPROACUMULATIVA', 0, True, True, 'Excluiu')) */}
          <Button label="&Histórico" variant="ghost" onClick={() => setHistorico(true)} />
        </div>
      </section>
      {historico && (
        <RegistrosLogModal log={{ form: 'FRMCADPROMOCAOACUMULATIVA', chave: 'IDPROACUMULATIVA', acao: 'Excluiu', exibirEmpresa: true, exibirValor: true }}
          valor={0} onFechar={() => setHistorico(false)} />
      )}
      {pesqProduto && (
        <Pesquisa resourcePath="lookup/produtos" fixos={{ ativo: 'S' }} onFechar={() => setPesqProduto(false)}
          onSelecionar={(l) => { setPesqProduto(false); void verificarProduto(String(l.codigo ?? l.idproduto ?? '')); }} />
      )}

      <DataTable rows={lista} columns={cols} getRowId={(p: Promo) => String(p.idproacumulativa)} />

      {doGrupo.length > 0 && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="mb-form-gap flex flex-wrap items-center gap-gp-md">
            <div className="text-body-sm text-fg-muted">
              Produtos do <strong>grupo de preço {String(doGrupo[0]?.desc_grupo ?? doGrupo[0]?.codgrupopreco)}</strong>
              {' '}— {doGrupo.length} produto(s), {doGrupo.filter((x) => x.idproacumulativa != null).length} com promoção
            </div>
            <Button label="Excluir promoção do &grupo inteiro" variant="soft" disabled={ocupado} onClick={() => void excluirGrupo()} />
          </div>
          <DataTable
            rows={doGrupo}
            columns={[
              { field: 'idproduto', headerName: 'Produto', type: 'text', width: 90, isPrimary: true },
              { field: 'descricao', headerName: 'Descrição', type: 'text' },
              { field: 'idproacumulativa', headerName: 'Promoção', type: 'text', width: 100,
                valueGetter: (r: any) => (r.idproacumulativa ?? '—') },
              { field: 'dtini', headerName: 'Início', type: 'text', width: 145, valueGetter: (r: any) => dataHora(r.dtini) },
              { field: 'dtfim', headerName: 'Término', type: 'text', width: 145, valueGetter: (r: any) => dataHora(r.dtfim) },
              { field: 'idempresa', headerName: 'Lojas', type: 'text', width: 110, valueGetter: (r: any) => lojasDe(r.idempresa).join(', ') },
            ] as DataTableColumnDef<any>[]}
            getRowId={(r: any) => `${r.idproduto}-${r.idproacumulativa ?? ''}`}
          />
        </section>
      )}
    </div>
  );
}
