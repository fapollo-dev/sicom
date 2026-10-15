import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { SelectField } from '../../shared/ui/SelectField';
import { Field } from '../../shared/ui/Field';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { listarContas, pendentes, sugestoes, conciliar, conciliarAutomatica, importarOfx, type ContaBancaria, type OfxLinha, type MovLinha, lancarAutomaticos, conciliadas, desfazerConciliacao, excluirOfx, type Conciliada, descricoesIgnoradas, gravarDescricaoIgnorada, previaOfx, movimentacaoOfx, type PreviaOfxLinha, type PeriodosConciliacao } from './conciliacaoApi';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** o mês corrente nas duas listas (StartOfTheMonth / EndOfTheMonth) */
export function mesCorrente(hoje = new Date()): PeriodosConciliacao {
  const ini = iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const fim = iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0));
  return { movIni: ini, movFim: fim, ofxIni: ini, ofxFim: fim };
}
const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

/**
 * CONCILIAÇÃO BANCÁRIA (OFX) (FRMCONCILIACAOBANCARIA). Escolhe a conta → «Importar .ofx» sobe o extrato do banco
 * (parser no servidor, dedup por FITID) → vê o extrato pendente × o razão interno pendente (mov_contas_bancarias) →
 * «Sugerir» casa automático por data+valor+direção → seleciona os dois lados → «Conciliar» (Σ iguais).
 */
export function ConciliacaoBancariaPage() {
  const mensagem = useMensagem();
  const { tem: pode } = useOpcoesDoForm('FRMCONCILIACAOBANCARIA'); // "Excluir movimentação OFX" é opção própria no legado
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [conta, setConta] = useState('');
  const [ofx, setOfx] = useState<OfxLinha[]>([]);
  const [mov, setMov] = useState<MovLinha[]>([]);
  const [selOfx, setSelOfx] = useState<Set<number>>(new Set());
  const [selMov, setSelMov] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [paresAuto, setParesAuto] = useState<Array<{ mboId: number; codmovcontas: number[] }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [feitas, setFeitas] = useState<Conciliada[]>([]);
  // os períodos das duas listas (CarregamentoInicialConciliacaoBancaria :697: o mês corrente), cada uma com o seu "Pesquisar"
  const [periodos, setPeriodos] = useState<PeriodosConciliacao>(() => mesCorrente());

  useEffect(() => { void listarContas().then(setContas).catch(() => setContas([])); }, []);

  const carregar = async (cod: number, per: PeriodosConciliacao = periodos) => {
    if (per.movIni > per.movFim || per.ofxIni > per.ofxFim) { mensagem.erro('A data inicial não pode ser maior que a final.'); return; }
    try {
      const p = await pendentes(cod, per);
      setOfx(p.ofx ?? []); setMov(p.mov ?? []); setSelOfx(new Set()); setSelMov(new Set()); setParesAuto([]);
      setFeitas(await conciliadas(cod).catch(() => []));
    } catch (e) { mensagem.erro(e); }
  };
  const escolherConta = (v: string) => { setConta(v); if (v) void carregar(Number(v)); else { setOfx([]); setMov([]); } };

  // desfazer uma conciliação: as linhas do extrato e do razão voltam a pendentes (a reversão do legado)
  const desfazer = async (c: Conciliada) => {
    if (busy || !window.confirm(`Desfazer a conciliação ${c.cb_id}? As ${c.qt_ofx} linha(s) do extrato e os ${c.qt_mov} lançamento(s) voltam a pendentes.`)) return;
    setBusy(true);
    try {
      await desfazerConciliacao(c.cb_id);
      mensagem.sucesso(`Conciliação ${c.cb_id} desfeita.`);
      await carregar(Number(conta));
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  // «Carregar arquivo» (BtnCarregarArquivoClick): a prévia com o status de cada linha; «Importar movimentações» leva as marcadas
  const [previa, setPrevia] = useState<{ nome: string; conteudo: string; linhas: PreviaOfxLinha[]; sel: Set<number> } | null>(null);
  const carregarArquivo = async (file: File) => {
    if (busy) return;
    if (!conta) { window.alert('Selecione a conta bancária antes de importar o extrato.'); return; }
    try {
      const conteudo = await file.text();
      const r = await previaOfx(Number(conta), conteudo);
      setPrevia({ nome: file.name, conteudo, linhas: r.linhas, sel: new Set(r.linhas.filter((l) => l.selecionar).map((l) => l.indice)) });
      mensagem.sucesso(r.linhas.length ? 'Arquivo foi importado com sucesso.' : 'Registros não encontrados.');
    } catch (e) { mensagem.erro(e); } finally { if (fileRef.current) fileRef.current.value = ''; }
  };
  const importarArquivo = async () => {
    if (busy || !previa || !conta) return;
    if (!previa.sel.size) { mensagem.erro('Nenhuma movimentação selecionada.'); return; }
    setBusy(true);
    try {
      const r = await importarOfx(Number(conta), previa.nome, previa.conteudo, [...previa.sel]);
      mensagem.sucesso(`${previa.nome}: ${r.inseridas} movimentação(ões) importada(s)${r.duplicadas ? `, ${r.duplicadas} já existiam` : ''}${r.ignoradas ? `, ${r.ignoradas} ignorada(s) pela lista de descrições da conta` : ''}.`);
      setPrevia(null);
      await carregar(Number(conta));
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  // a aba "Movimentação OFX" (BtnPesquisarMovOFXClick): o extrato da conta no período, conciliado ou não
  const [movOfx, setMovOfx] = useState<{ ini: string; fim: string; linhas: Awaited<ReturnType<typeof movimentacaoOfx>> | null }>(() => ({ ini: mesCorrente().ofxIni, fim: mesCorrente().ofxFim, linhas: null }));
  const pesquisarMovOfx = async () => {
    if (!conta) return;
    if (movOfx.ini > movOfx.fim) { mensagem.erro('A data inicial não pode ser maior que a final.'); return; }
    try { setMovOfx({ ...movOfx, linhas: await movimentacaoOfx(Number(conta), movOfx.ini, movOfx.fim) }); } catch (e) { mensagem.erro(e); }
  };
  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, id: number) => {
    const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setter(n);
  };

  const sugerir = async () => {
    if (!conta) return;
    try {
      const { pares, lotes } = await sugestoes(Number(conta), periodos);
      if (!pares.length && !lotes.length) { mensagem.sucesso('Nenhum par automático (data+valor) encontrado.'); return; }
      // o LOTE vem primeiro: uma baixa em lote vira UM movimento no extrato, e ele só concilia inteiro
      setSelOfx(new Set([...lotes.map((l) => l.mbo_id), ...pares.map((p) => p.mbo_id)]));
      setSelMov(new Set([...lotes.flatMap((l) => l.codmovcontas), ...pares.map((p) => p.codmovconta)]));
      setParesAuto([...lotes.map((l) => ({ mboId: l.mbo_id, codmovcontas: l.codmovcontas })), ...pares.map((p) => ({ mboId: p.mbo_id, codmovcontas: [p.codmovconta] }))]);
      const parteLote = lotes.length ? ` e ${lotes.length} lote(s) inteiro(s)` : '';
      mensagem.sucesso(`${pares.length} par(es)${parteLote} sugerido(s). Confira e confirme a conciliação automática.`);
    } catch (e) { mensagem.erro(e); }
  };

  // mig 298: a linha do extrato que casa com uma regra da conta vira lançamento e já sai conciliada
  const lancarAuto = async () => {
    if (busy || !conta) return;
    setBusy(true);
    try {
      const r = await lancarAutomaticos(Number(conta));
      mensagem.sucesso(r.lancados
        ? `${r.lancados} linha(s) do extrato lançada(s) e conciliada(s) pelas regras da conta.`
        : 'Nenhuma linha pendente casa com uma regra de lançamento automático desta conta.');
      await carregar(Number(conta));
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const totOfx = ofx.filter((o) => selOfx.has(o.mbo_id)).reduce((s, o) => s + Number(o.mbo_valor), 0);
  const totMov = mov.filter((m) => selMov.has(m.codmovconta)).reduce((s, m) => s + Number(m.valor), 0);
  const iguais = Math.round(totOfx * 100) === Math.round(totMov * 100);

  // a automática confirmada: um evento por par, cada movimento liberado na data da sua emissão (ConfirmaConciliacaoAutomatica)
  const confirmarAuto = async () => {
    if (busy || !conta || !paresAuto.length) return;
    setBusy(true);
    try {
      const r = await conciliarAutomatica(Number(conta), paresAuto);
      mensagem.sucesso(`${r.conciliacoes} conciliação(ões) automática(s) gravada(s) — ${r.mov} lançamento(s) liberado(s).`);
      setParesAuto([]);
      await carregar(Number(conta));
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const conciliarSel = async () => {
    if (busy || !conta) return;
    if (!selOfx.size || !selMov.size) { window.alert('Selecione linhas do extrato E do razão.'); return; }
    if (!iguais) { window.alert(`Os totais precisam ser iguais (extrato ${brl(totOfx)} × razão ${brl(totMov)}).`); return; }
    setBusy(true);
    try {
      const r = await conciliar(Number(conta), [...selOfx], [...selMov]);
      mensagem.sucesso(`Conciliação ${r.cb_id} gravada — ${r.ofx} linha(s) do extrato × ${r.mov} lançamento(s), total ${brl(r.total)}.`);
      await carregar(Number(conta));
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const excluirSel = async () => {
    if (busy || !conta || !selOfx.size) return;
    if (!window.confirm(`Excluir ${selOfx.size} linha(s) do extrato? Elas saem da conciliação e o arquivo pode ser importado de novo.`)) return;
    setBusy(true);
    try {
      const r = await excluirOfx(Number(conta), [...selOfx]);
      mensagem.sucesso(`${r.excluidas} linha(s) do extrato excluída(s).`);
      await carregar(Number(conta));
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Conciliação Bancária (OFX)" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-72"><SelectField label="Conta bancária" value={conta} onChange={escolherConta} options={contas.map((c) => ({ value: String(c.codconta), label: `${c.banco ?? ''} ${c.titular ?? ''}`.trim() || String(c.codconta) }))} placeholder="(selecione a conta)" /></div>
        <input ref={fileRef} type="file" accept=".ofx,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void carregarArquivo(f); }} />
        <Button label="&Carregar arquivo" variant="ghost" disabled={busy || !conta} onClick={() => fileRef.current?.click()} />
        <Button label="&Sugerir automática" variant="ghost" disabled={!conta || !ofx.length} onClick={() => void sugerir()} />
        {paresAuto.length > 0 && <Button label={`Confirmar a&utomática (${paresAuto.length})`} variant="soft" disabled={busy} onClick={() => void confirmarAuto()} />}
        <Button label="&Lançamentos automáticos" variant="ghost" disabled={busy || !conta || !ofx.length} onClick={() => void lancarAuto()} />
        <Button label="&Conciliar selecionados" variant="soft" disabled={busy || !iguais || !selOfx.size || !selMov.size} onClick={() => void conciliarSel()} />
        <Button label="E&xcluir do extrato" variant="ghost" disabled={busy || !selOfx.size || !pode('BTNPERMISSAOEXCLUIROFX')} onClick={() => void excluirSel()} />
        <div className="flex-1 text-right text-body-sm">Selecionado — extrato <b className={iguais ? 'text-fg' : 'text-danger'}>{brl(totOfx)}</b> · razão <b className={iguais ? 'text-fg' : 'text-danger'}>{brl(totMov)}</b> {selOfx.size + selMov.size > 0 && (iguais ? '✓' : '≠')}</div>
        {conta && <IgnoradasOfx codconta={Number(conta)} />}
        <small className="w-full text-fg-muted">Importe o extrato do banco (arquivo .ofx) e case com o razão de contas-correntes por data + valor + direção. O lote só concilia INTEIRO (uma baixa em lote vira um movimento no extrato). Os ramos A-Pagar/A-Receber por lote são cortes futuros.</small>
      </div>

      {previa && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex items-center justify-between">
            <strong className="text-body-sm">Importação de arquivo OFX — {previa.nome}</strong>
            <div className="flex gap-gp-sm">
              <Button label="&Importar movimentações" variant="soft" disabled={busy || !previa.sel.size} onClick={() => void importarArquivo()} />
              <Button label="Fechar" variant="ghost" onClick={() => setPrevia(null)} />
            </div>
          </div>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-body-sm">
              <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs">Selecionar</th><th className="p-pad-xs">Data</th><th className="p-pad-xs text-right">Valor</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs">Transação ID</th><th className="p-pad-xs">Check Num</th><th className="p-pad-xs">Status</th></tr></thead>
              <tbody>
                {previa.linhas.map((l) => (
                  <tr key={l.indice} className={`border-t border-border ${l.status !== 'OK' ? 'text-fg-muted' : ''}`}>
                    <td className="p-pad-xs"><input type="checkbox" aria-label={`Selecionar ${l.indice}`} checked={previa.sel.has(l.indice)}
                      onChange={() => setPrevia((p) => { if (!p) return p; const n = new Set(p.sel); n.has(l.indice) ? n.delete(l.indice) : n.add(l.indice); return { ...p, sel: n }; })} /></td>
                    <td className="p-pad-xs">{dia(l.data)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{l.credito_debito === 'D' ? '−' : ''}{brl(l.valor)}</td>
                    <td className="p-pad-xs">{l.descricao ?? ''}</td>
                    <td className="p-pad-xs tabular-nums">{l.transacao_id ?? ''}</td>
                    <td className="p-pad-xs tabular-nums">{l.check_num ?? ''}</td>
                    <td className="p-pad-xs">{l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* os períodos das duas listas (os dois "Pesquisar" da conciliação manual — a tela abre no mês corrente) */}
      {conta && (
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-36"><Field label="Extrato de" type="date" value={periodos.ofxIni} onChange={(e) => setPeriodos({ ...periodos, ofxIni: e.target.value })} /></div>
          <div className="w-36"><Field label="até" type="date" value={periodos.ofxFim} onChange={(e) => setPeriodos({ ...periodos, ofxFim: e.target.value })} /></div>
          <div className="w-36"><Field label="Razão de" type="date" value={periodos.movIni} onChange={(e) => setPeriodos({ ...periodos, movIni: e.target.value })} /></div>
          <div className="w-36"><Field label="até" type="date" value={periodos.movFim} onChange={(e) => setPeriodos({ ...periodos, movFim: e.target.value })} /></div>
          <Button label="&Pesquisar" variant="soft" disabled={busy} onClick={() => void carregar(Number(conta))} />
          <Button label="Exportar extrato" variant="ghost" disabled={!ofx.length}
            onClick={() => exportarGradeCsv(ofx, [{ titulo: 'Data', valor: (o) => dia(o.mbo_data) }, { titulo: 'Valor', valor: (o) => brl(o.mbo_valor) }, { titulo: 'Histórico', valor: (o) => o.mbo_descricao ?? '' }], 'ExtratoOFX')} />
          <Button label="Exportar razão" variant="ghost" disabled={!mov.length}
            onClick={() => exportarGradeCsv(mov, [{ titulo: 'Data', valor: (m) => dia(m.data) }, { titulo: 'Valor', valor: (m) => brl(m.valor) }, { titulo: 'Histórico', valor: (m) => m.historico ?? m.origem ?? '' }], 'MovimentacoesBancarias')} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-gp-md md:grid-cols-2">
        <div className="tablecard overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <div className="border-b border-border p-pad-xs text-body-sm font-semibold text-fg-muted">Extrato (OFX) pendente — {ofx.length}</div>
          <table className="w-full text-body-sm">
            <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs" /><th className="p-pad-xs">Data</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs text-right">Valor</th></tr></thead>
            <tbody>
              {ofx.map((o) => (
                <tr key={o.mbo_id} className={`border-t border-border ${selOfx.has(o.mbo_id) ? 'bg-bg-subtle' : ''}`}>
                  <td className="p-pad-xs"><input type="checkbox" checked={selOfx.has(o.mbo_id)} onChange={() => toggle(selOfx, setSelOfx, o.mbo_id)} /></td>
                  <td className="p-pad-xs">{dia(o.mbo_data)}</td>
                  <td className="p-pad-xs">{o.mbo_descricao ?? '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{o.mbo_credito_debito === 'D' ? '−' : ''}{brl(o.mbo_valor)}</td>
                </tr>
              ))}
              {!ofx.length && <tr><td colSpan={4} className="p-pad-md text-fg-muted">Sem extrato pendente no período. Use «Carregar arquivo» para subir o extrato do banco.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="tablecard overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <div className="border-b border-border p-pad-xs text-body-sm font-semibold text-fg-muted">Razão interno pendente — {mov.length}</div>
          <table className="w-full text-body-sm">
            <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs" /><th className="p-pad-xs">Data</th><th className="p-pad-xs">Histórico</th><th className="p-pad-xs text-right">Valor</th></tr></thead>
            <tbody>
              {mov.map((m) => (
                <tr key={m.codmovconta} className={`border-t border-border ${selMov.has(m.codmovconta) ? 'bg-bg-subtle' : ''}`}>
                  <td className="p-pad-xs"><input type="checkbox" checked={selMov.has(m.codmovconta)} onChange={() => toggle(selMov, setSelMov, m.codmovconta)} /></td>
                  <td className="p-pad-xs">{dia(m.data)}</td>
                  <td className="p-pad-xs">{m.historico ?? m.origem ?? '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(m.valor)}</td>
                </tr>
              ))}
              {!mov.length && <tr><td colSpan={4} className="p-pad-md text-fg-muted">Sem lançamentos pendentes no razão no período.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {conta && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <strong className="text-body-sm">Movimentação OFX</strong>
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-36"><Field label="Data inicial" type="date" value={movOfx.ini} onChange={(e) => setMovOfx({ ...movOfx, ini: e.target.value })} /></div>
            <div className="w-36"><Field label="Data final" type="date" value={movOfx.fim} onChange={(e) => setMovOfx({ ...movOfx, fim: e.target.value })} /></div>
            <Button label="Pesquisar" variant="ghost" onClick={() => void pesquisarMovOfx()} />
          </div>
          {movOfx.linhas && (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-body-sm">
                <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs">Data</th><th className="p-pad-xs text-right">Valor</th><th className="p-pad-xs">Crédito/Débito</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs">ID transação</th><th className="p-pad-xs">Conciliado</th></tr></thead>
                <tbody>
                  {movOfx.linhas.map((o) => (
                    <tr key={o.mbo_id} className="border-t border-border">
                      <td className="p-pad-xs">{dia(o.mbo_data)}</td>
                      <td className="p-pad-xs text-right tabular-nums">{brl(o.mbo_valor)}</td>
                      <td className="p-pad-xs">{o.mbo_credito_debito === 'D' ? 'Débito' : 'Crédito'}</td>
                      <td className="p-pad-xs">{o.mbo_descricao ?? ''}</td>
                      <td className="p-pad-xs tabular-nums">{o.mbo_transacao_id ?? ''}</td>
                      <td className="p-pad-xs">{o.mbo_conciliado === 'S' ? 'Sim' : 'Não'}</td>
                    </tr>
                  ))}
                  {!movOfx.linhas.length && <tr><td colSpan={6} className="p-pad-md text-fg-muted">Nenhuma movimentação no período.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {feitas.length > 0 && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Conciliação</th><th className="p-pad-xs">Data</th><th className="p-pad-xs">Operador</th>
                <th className="p-pad-xs">Extrato</th><th className="p-pad-xs text-right">Valor</th><th className="p-pad-xs">Razão</th><th className="p-pad-xs" />
              </tr>
            </thead>
            <tbody>
              {feitas.map((c) => (
                <tr key={c.cb_id} className="border-b border-border/50">
                  <td className="p-pad-xs tabular-nums">{c.cb_id}</td>
                  <td className="p-pad-xs">{c.cb_data ? new Date(c.cb_data).toLocaleString('pt-BR') : ''}</td>
                  <td className="p-pad-xs">{c.operador ?? ''}</td>
                  <td className="p-pad-xs">{c.qt_ofx} · {c.descricao ?? ''}</td>
                  <td className="p-pad-xs text-right tabular-nums">{Number(c.total_ofx).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                  <td className="p-pad-xs">{c.qt_mov} lançamento(s)</td>
                  <td className="p-pad-xs"><Button label="Desfazer" variant="ghost" disabled={busy} onClick={() => void desfazer(c)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** as descrições do extrato que a importação do .ofx ignora nesta conta (igualdade exata — CFG_DESCRICAO_NAO_IMPORTAR_OFX) */
function IgnoradasOfx({ codconta }: { codconta: number }) {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<string[]>([]);
  const [nova, setNova] = useState('');
  const [aberto, setAberto] = useState(false);
  useEffect(() => { if (aberto) void descricoesIgnoradas(codconta).then(setLista).catch((e) => mensagem.erro(e)); }, [codconta, aberto, mensagem]);
  const gravar = async (d: string, remover: boolean) => {
    try { setLista(await gravarDescricaoIgnorada(codconta, d, remover)); if (!remover) setNova(''); } catch (e) { mensagem.erro(e); }
  };
  return (
    <div className="w-full text-body-sm">
      <button className="underline" onClick={() => setAberto((a) => !a)}>{aberto ? 'Fechar' : 'Descrições que a importação ignora'}</button>
      {aberto && (
        <div className="mt-gp-xs flex flex-wrap items-center gap-gp-sm">
          {lista.map((d) => (
            <span key={d} className="rounded-radius-sm border border-border px-1">{d} <button aria-label={`Tirar ${d}`} className="underline" onClick={() => void gravar(d, true)}>tirar</button></span>
          ))}
          {!lista.length && <span className="text-fg-muted">nenhuma</span>}
          <input aria-label="Nova descrição ignorada" className="rounded-radius-sm border border-border bg-bg px-1 py-0.5" maxLength={250} placeholder="descrição exata do extrato" value={nova} onChange={(e) => setNova(e.target.value)} />
          <Button label="Acrescentar" variant="ghost" disabled={!nova.trim()} onClick={() => void gravar(nova, false)} />
        </div>
      )}
    </div>
  );
}
