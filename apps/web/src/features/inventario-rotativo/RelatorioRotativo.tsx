import { useEffect, useState } from 'react';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';
import { CodigosComPesquisa } from '../../shared/pesquisa/CodigosComPesquisa';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function req<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, body === undefined ? { headers: apiHeaders() } : { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
  handle401(res);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: res.status, code: 'ERRO', message: (b as any)?.message ?? res.statusText };
    throw Object.assign(new Error(env.code ?? res.statusText), { envelope: env, status: res.status, body: b });
  }
  return (await res.json()) as T;
}
type Linha = Record<string, unknown>;
type Opcao = 'DETALHADO' | 'RESUMIDO' | 'NAO_COLETADOS' | 'DEPOSITO' | 'AREA_VENDA';
const OPCOES: Array<{ v: Opcao; rotulo: string }> = [
  { v: 'DETALHADO', rotulo: 'Detalhado - Todas as Operações' },
  { v: 'RESUMIDO', rotulo: 'Resumido - Somente a Última Operação' },
  { v: 'NAO_COLETADOS', rotulo: 'Produtos não coletados' },
  { v: 'DEPOSITO', rotulo: 'Somente Depósito (inexistente na área de venda)' },
  { v: 'AREA_VENDA', rotulo: 'Somente Área de Venda (inexistente no depósito)' },
];
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
const qtd = (v: unknown) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const vr = (v: unknown) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const hoje = () => new Date().toISOString().slice(0, 10);
const codigos = (s: string) => s.split(/[^\d]+/).filter(Boolean).map(Number);

/**
 * O RELATÓRIO do inventário rotativo (o "Grid" e o "Imprimir" do FRMRELINVENTARIOROTATIVO): escolhe aberto/fechado, o lote na grade (e,
 * no resumido de inventário fechado, marca os lotes), a opção e os filtros; "Agrupar lotes" só no detalhado (nas outras o legado o deixa
 * marcado e escondido).
 */
export function RelatorioRotativo() {
  const mensagem = useMensagem();
  const [status, setStatus] = useState<'ABERTO' | 'FECHADO'>('ABERTO');
  const [dataini, setDataini] = useState(hoje());
  const [datafin, setDatafin] = useState(hoje());
  const [lotes, setLotes] = useState<Linha[]>([]);
  const [lote, setLote] = useState<number | null>(null);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [opcao, setOpcao] = useState<Opcao>('DETALHADO');
  const [tipoEstoque, setTipoEstoque] = useState(2);
  const [agrupar, setAgrupar] = useState(false);
  const [filtros, setFiltros] = useState({ login: '', codfor: '', coddpto: '', codgrupo: '', codsubgrupo: '', codsecao: '', produtos: '' });
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [busy, setBusy] = useState(false);

  const carregarLotes = async (st = status) => {
    try {
      const q = new URLSearchParams({ status: st, dataini, datafin });
      const r = await req<{ itens: Linha[] }>(`/cadastro/inventario-rotativo/relatorio/lotes?${q.toString()}`);
      setLotes(r.itens); setMarcados(new Set()); setLote(r.itens.length ? Number(r.itens[0].lote) : null);
    } catch (e) { mensagem.erro(e); }
  };
  useEffect(() => { void carregarLotes('ABERTO'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const corpo = () => {
    const n = (s: string) => (s.trim() ? Number(s) : undefined);
    return {
      opcao, status, dataini, datafin, lote: lote ?? 0, lotes: Array.from(marcados), agrupar: opcao === 'DETALHADO' ? agrupar : true, tipoEstoque,
      login: filtros.login.trim() || undefined, codfor: n(filtros.codfor), coddpto: n(filtros.coddpto), codgrupo: n(filtros.codgrupo),
      codsubgrupo: n(filtros.codsubgrupo), codsecao: filtros.codsecao.trim() ? Number(filtros.codsecao) : undefined,
      produtos: filtros.produtos.trim() ? codigos(filtros.produtos) : undefined,
    };
  };
  const grid = async () => {
    if (lote == null) return mensagem.erro(new Error('Selecione um lote.'));
    setBusy(true);
    try { setLinhas((await req<{ linhas: Linha[] }>('/cadastro/inventario-rotativo/relatorio', corpo())).linhas); }
    catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  const imprimir = async () => {
    if (lote == null) return mensagem.erro(new Error('Selecione um lote.'));
    try { await imprimirRelatorio('/cadastro/inventario-rotativo/relatorio/impressao', corpo()); } catch (e) { mensagem.erro(e); }
  };
  const marcar = (l: number) => { const s = new Set(marcados); if (s.has(l)) s.delete(l); else s.add(l); setMarcados(s); };
  const colSel = opcao === 'RESUMIDO' && status === 'FECHADO';
  const destinoFixo = opcao === 'DEPOSITO' || opcao === 'AREA_VENDA';

  return (
    <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
      <div className="text-title-sm font-semibold">Relatório do inventário rotativo</div>
      <div className="flex flex-wrap items-end gap-gp-sm">
        <fieldset className="flex items-center gap-gp-sm text-body-sm">
          <legend className="text-fg-muted">Selecione Inventário Aberto / Fechado:</legend>
          {(['ABERTO', 'FECHADO'] as const).map((st) => (
            <label key={st} className="flex items-center gap-1">
              <input type="radio" checked={status === st} onChange={() => { setStatus(st); void carregarLotes(st); }} /> {st === 'ABERTO' ? 'Aberto' : 'Fechado'}
            </label>
          ))}
        </fieldset>
        <div className="w-40"><Field label="Data inicial" type="date" value={dataini} onChange={(e) => setDataini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={datafin} onChange={(e) => setDatafin(e.target.value)} /></div>
        <Button label="Atualizar &lotes" variant="ghost" onClick={() => void carregarLotes()} />
      </div>

      <div className="max-h-56 overflow-auto rounded-radius-sm border border-border">
        <table className="w-full text-body-sm">
          <thead><tr className="text-left text-fg-muted">
            {colSel && <th className="p-pad-xs">Sel.</th>}<th className="p-pad-xs">Lote</th><th className="p-pad-xs">Nome</th>
            <th className="p-pad-xs">Abertura</th>{status === 'FECHADO' && <th className="p-pad-xs">Fechamento</th>}
            <th className="p-pad-xs">NF perdas</th><th className="p-pad-xs">NF sobras</th>
          </tr></thead>
          <tbody>
            {lotes.map((l, i) => (
              <tr key={`${String(l.lote)}-${i}`} onClick={() => setLote(Number(l.lote))}
                className={`cursor-pointer border-t border-border ${lote === Number(l.lote) ? 'bg-bg-subtle' : ''}`}>
                {colSel && <td className="p-pad-xs"><input type="checkbox" checked={marcados.has(Number(l.lote))} onChange={() => marcar(Number(l.lote))} onClick={(e) => e.stopPropagation()} /></td>}
                <td className="p-pad-xs tabular-nums">{String(l.lote)}</td><td className="p-pad-xs">{String(l.nomelote ?? '')}</td>
                <td className="p-pad-xs tabular-nums">{dia(l.abertura)}</td>{status === 'FECHADO' && <td className="p-pad-xs tabular-nums">{dia(l.fechamento)}</td>}
                <td className="p-pad-xs tabular-nums">{String(l.codnf_perdas ?? '')}</td><td className="p-pad-xs tabular-nums">{String(l.codnf_sobras ?? '')}</td>
              </tr>
            ))}
            {!lotes.length && <tr><td colSpan={7} className="p-pad-md text-fg-muted">Nenhum lote.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-start gap-gp-md">
        <fieldset className="flex flex-col gap-1 text-body-sm">
          <legend className="text-fg-muted">Selecione uma Opção:</legend>
          {OPCOES.map((o) => (
            <label key={o.v} className="flex items-center gap-1">
              <input type="radio" checked={opcao === o.v} onChange={() => { setOpcao(o.v); setAgrupar(false); }} /> {o.rotulo}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-1 text-body-sm" disabled={destinoFixo}>
          <legend className="text-fg-muted">Tipo de Estoque</legend>
          {['Depósito', 'Loja', 'Ambos'].map((r, i) => (
            <label key={r} className="flex items-center gap-1"><input type="radio" checked={tipoEstoque === i} onChange={() => setTipoEstoque(i)} /> {r}</label>
          ))}
        </fieldset>
        {opcao === 'DETALHADO' && (
          <label className="flex items-center gap-1 text-body-sm" title="Utilizar como filtro o periodo do filtrado e agrupar os lotes encontrados.">
            <input type="checkbox" checked={agrupar} onChange={(e) => setAgrupar(e.target.checked)} /> Agrupar lotes
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-gp-sm">
        <div className="w-32"><Field label="L&ogin" value={filtros.login} onChange={(e) => setFiltros({ ...filtros, login: e.target.value })} /></div>
        <div className="w-28"><Field label="Fornecedor" value={filtros.codfor} inputMode="numeric" onChange={(e) => setFiltros({ ...filtros, codfor: e.target.value.replace(/\D/g, '') })} /></div>
        <div className="w-28"><Field label="Departamento" value={filtros.coddpto} inputMode="numeric" onChange={(e) => setFiltros({ ...filtros, coddpto: e.target.value.replace(/\D/g, '') })} /></div>
        <div className="w-24"><Field label="Grupo" value={filtros.codgrupo} inputMode="numeric" onChange={(e) => setFiltros({ ...filtros, codgrupo: e.target.value.replace(/\D/g, '') })} /></div>
        <div className="w-24"><Field label="Subgrupo" value={filtros.codsubgrupo} inputMode="numeric" onChange={(e) => setFiltros({ ...filtros, codsubgrupo: e.target.value.replace(/\D/g, '') })} /></div>
        <div className="w-24"><Field label="Seção" value={filtros.codsecao} inputMode="numeric" onChange={(e) => setFiltros({ ...filtros, codsecao: e.target.value.replace(/\D/g, '') })} /></div>
        {/* uRelatorioInventarioRotativo.pas:1179: a GET_PRODUTOS em multisseleção (o I.IDPRODUTO IN do relatório) */}
        <CodigosComPesquisa label="Filtrar Produtos (códigos)" value={filtros.produtos} onChange={(v) => setFiltros({ ...filtros, produtos: v })} recurso="lookup/produtos" />
        <Button label="&Grid" variant="soft" disabled={busy} onClick={() => void grid()} />
        <Button label="&Imprimir" variant="soft" disabled={busy} onClick={() => void imprimir()} />
      </div>

      {linhas && (
        <div className="flex flex-col gap-gp-xs">
          <div className="flex items-center justify-between text-body-sm text-fg-muted">
            <span>{linhas.length} linha(s)</span>
            <Button label="Exportar" variant="ghost" disabled={!linhas.length} onClick={() => exportarGradeCsv(linhas, [
              { titulo: 'Código', valor: (l) => l.codbarra }, { titulo: 'Descrição', valor: (l) => l.descricao },
              { titulo: 'Qtd. anterior', valor: (l) => qtd(l.qtd_anterior) }, { titulo: 'Qtd. coletada', valor: (l) => qtd(l.qtd_coletada) },
              { titulo: 'Diferença qtd', valor: (l) => qtd(l.diferenca_qtd) }, { titulo: 'Vr. custo', valor: (l) => vr(l.vrcusto) },
              { titulo: 'Diferença valor', valor: (l) => vr(l.diferenca_valor) }, { titulo: 'Estoque', valor: (l) => qtd(l.estoque) },
              { titulo: 'Operação', valor: (l) => l.operacao }, { titulo: 'Departamento', valor: (l) => l.depto }, { titulo: 'Grupo', valor: (l) => l.grupo },
            ], 'inventario-rotativo')} />
          </div>
          <div className="max-h-96 overflow-auto rounded-radius-sm border border-border">
            <table className="w-full text-body-sm">
              <thead><tr className="text-left text-fg-muted">
                <th className="p-pad-xs">Código</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs text-right">Qtd. anterior</th>
                <th className="p-pad-xs text-right">{opcao === 'DETALHADO' ? 'Qtd. coletada' : 'Última qtd.'}</th><th className="p-pad-xs text-right">Diferença qtd</th>
                <th className="p-pad-xs text-right">Vr. custo</th><th className="p-pad-xs text-right">Diferença valor</th><th className="p-pad-xs text-right">Estoque</th>
                {opcao === 'DETALHADO' && <th className="p-pad-xs">Operação</th>}<th className="p-pad-xs">Departamento</th><th className="p-pad-xs">Grupo</th>
                {opcao === 'NAO_COLETADOS' && <><th className="p-pad-xs">Última venda</th><th className="p-pad-xs">Última compra</th></>}
              </tr></thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-pad-xs">{String(l.codbarra ?? '')}</td><td className="p-pad-xs">{String(l.descricao ?? '')}</td>
                    <td className="p-pad-xs text-right tabular-nums">{qtd(l.qtd_anterior)}</td><td className="p-pad-xs text-right tabular-nums">{qtd(l.qtd_coletada)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{qtd(l.diferenca_qtd)}</td><td className="p-pad-xs text-right tabular-nums">{vr(l.vrcusto)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{vr(l.diferenca_valor)}</td><td className="p-pad-xs text-right tabular-nums">{qtd(l.estoque)}</td>
                    {opcao === 'DETALHADO' && <td className="p-pad-xs">{String(l.operacao ?? '')}</td>}
                    <td className="p-pad-xs">{String(l.depto ?? '')}</td><td className="p-pad-xs">{String(l.grupo ?? '')}</td>
                    {opcao === 'NAO_COLETADOS' && <><td className="p-pad-xs tabular-nums">{dia(l.dtultimavenda)}</td><td className="p-pad-xs tabular-nums">{dia(l.dtultimacompra)}</td></>}
                  </tr>
                ))}
                {!linhas.length && <tr><td colSpan={13} className="p-pad-md text-fg-muted">Nenhuma linha.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
