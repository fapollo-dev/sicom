import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirPagina } from '../../shared/print/imprimirPagina';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: apiHeaders(), ...init });
  handle401(res);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: res.status, code: 'ERRO', message: (b as any)?.message ?? res.statusText };
    throw Object.assign(new Error(env.code ?? res.statusText), { envelope: env, status: res.status, body: b });
  }
  return (await res.json()) as T;
}
const post = <T,>(path: string, body: unknown) => req<T>(path, { method: 'POST', body: JSON.stringify(body) });

const brl = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const atras = (dias: number) => { const d = new Date(Date.now() - dias * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

type Linha = Record<string, unknown>;
interface ParcelaEd { nrparcela: string; valor: string; dtvenc: string }
interface Sugestao {
  chavenfe: string; nronf: string; razao: string | null; totalnf: number; fonte: 'FINANCEIRO' | 'XML' | 'TOTAL';
  configurado: boolean; codparceiro: number | null; fornecedor: string | null; jaGerada: boolean;
  parcelas: Array<{ nrparcela: string; valor: number; dtvenc: string | null }>;
}
interface ItemAnalise {
  nroitem: number; codprod: string; ean: string; descricao: string; ncm: string; cfop: number | null; unidade: string; quantidade: number;
  fatorembal: number; vrunitario: number; vrtotal: number; vrunitario_trib: number; idproduto: number | null; produto_codbarra: string | null;
  produto_descricao: string | null; produto_cadastrado: 'S' | 'N';
}
interface Analise {
  chave: string; numero: string; razao: string; cnpj: string; total: number; editavel: boolean;
  parceiro: { codparceiro: number | null; status: 'ATIVO' | 'INATIVO' | 'NAO_CADASTRADO' }; itens: ItemAnalise[];
}
const STATUS_PARCEIRO: Record<Analise['parceiro']['status'], string> = { ATIVO: 'PARCEIRO ATIVO', INATIVO: 'PARCEIRO INATIVO', NAO_CADASTRADO: 'PARCEIRO NÃO CAD.' };

const FONTE: Record<Sugestao['fonte'], string> = {
  FINANCEIRO: 'parcelas da grade financeira da nota',
  XML: 'duplicatas do XML',
  TOTAL: 'a nota não tem duplicatas — uma parcela com o total; informe o vencimento',
};

/**
 * MANIFESTO DO DESTINATÁRIO (FRMMANIFESTODFE — UManifestoDFe.pas). A grade é a GET_NF_MANIFESTO da loja: as NF com chave
 * (entrada e saída — importada, processada, esteira) e a fila das não cadastradas, dentro da janela de dias do manifesto.
 * As manifestações vão para as notas MARCADAS (um evento por chave), com o retorno de cada uma no Log. Cores do legado:
 * cancelada em vermelho, não importada em negrito, processada em verde.
 */
export function ManifestoDfePage() {
  const mensagem = useMensagem();
  const navigate = useNavigate();
  const [dtini, setDtini] = useState('');
  const [dtfim, setDtfim] = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [chave, setChave] = useState('');
  const [canceladas, setCanceladas] = useState('TODOS');
  const [pendentes, setPendentes] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Record<string, unknown> | null>(null);
  const [eventos, setEventos] = useState<Linha[] | null>(null);
  const [chaveEv, setChaveEv] = useState('');
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<Array<{ tipo: string; chave: string; descricao: string }>>([]);
  // a previsão de contas a pagar da nota (binário novo): a sugestão e as parcelas que o usuário ajusta
  const [prev, setPrev] = useState<{ cod: number; sug: Sugestao; parcelas: ParcelaEd[] } | null>(null);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await post<{ linhas: Linha[]; totais: Record<string, unknown> }>('/compras/manifesto-dfe/listar', {
        dtini: dtini || undefined, dtfim: dtfim || undefined, fornecedor: fornecedor || undefined, cnpj: cnpj || undefined,
        chave: chave || undefined, canceladas, pendentes,
      });
      setLinhas(r.linhas); setTotais(r.totais); setEventos(null); setSel(new Set());
      if (!r.linhas.length) mensagem.sucesso('Nenhuma NF-e no filtro informado.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const ROTULO: Record<string, string> = { CIENCIA: 'CIÊNCIA DA OPERAÇÃO', CONFIRMACAO: 'CONFIRMAÇÃO DA OPERAÇÃO', DESCONHECIMENTO: 'DESCONHECIMENTO DA OPERAÇÃO', OPERACAO_NAO_REALIZADA: 'OPERAÇÃO NÃO REALIZADA' };
  // ManifestacaoDestinatario: as marcadas, com a confirmação do evento e a justificativa da operação não realizada
  const manifestarMarcadas = async (evento: string) => {
    if (busy) return;
    const chaves = [...sel];
    if (!chaves.length) { mensagem.erro(new Error('Selecione pelo menos uma nota fiscal para realizar a manifestação.')); return; }
    if (!window.confirm(`Evento: ${ROTULO[evento]}\nDeseja realmente enviar esta manifestação?`)) return;
    let justificativa: string | undefined;
    if (evento === 'OPERACAO_NAO_REALIZADA') {
      const j = window.prompt('Informe a justificativa para Operação Não Realizada');
      if (!j?.trim()) return;
      justificativa = j.trim();
    }
    setBusy(true);
    try {
      const r = await post<{ enviadas: number; log: Array<{ tipo: string; chave: string; descricao: string }>; importacao: { codnf?: number } | null }>(
        '/compras/manifesto-dfe/manifestar-lote', { chaves, evento, justificativa });
      setLog(r.log);
      mensagem.sucesso(`Processo finalizado! ${r.enviadas} manifestação(ões) enviada(s).${r.log.some((l) => l.tipo === 'E') ? ' Verifique o Log para eventuais erros.' : ''}${r.importacao?.codnf ? ` NF importada: ${r.importacao.codnf}.` : ''}`);
      setBusy(false);
      await consultar();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  // a análise dos itens da nota (o botão "Itens" da grade, só entrada)
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [fatores, setFatores] = useState<Record<number, string>>({});
  const [filtroItens, setFiltroItens] = useState<'T' | 'S' | 'N'>('T');
  const refAnalise = useRef<HTMLDivElement>(null);
  const abrirAnalise = (a: Analise) => { setAnalise(a); setFatores(Object.fromEntries(a.itens.map((i) => [i.nroitem, String(i.fatorembal)]))); };
  const analisarItens = async (ch: string) => {
    if (busy) return;
    setBusy(true);
    try { abrirAnalise(await req<Analise>(`/compras/manifesto-dfe/itens/${ch}`)); }
    catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  const acaoAnalise = async (caminho: string, body: unknown, msg: string) => {
    if (!analise || busy) return;
    setBusy(true);
    try {
      const r = await post<{ itens: ItemAnalise[] }>(`/compras/manifesto-dfe/itens/${analise.chave}/${caminho}`, body);
      abrirAnalise({ ...analise, itens: r.itens });
      mensagem.sucesso(msg);
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  const gravarFatores = () => acaoAnalise('fatores', { itens: Object.entries(fatores).map(([nroitem, f]) => ({ nroitem: Number(nroitem), fatorembal: Number(String(f).replace(',', '.')) || 0 })) }, 'Fatores gravados.');
  const vincularItem = (it: ItemAnalise) => {
    const cod = window.prompt(`Código interno do produto para "${it.descricao}":`);
    if (!cod?.trim() || !/^\d+$/.test(cod.trim())) return;
    void acaoAnalise('vincular', { nroitem: it.nroitem, idproduto: Number(cod.trim()) }, 'Item vinculado (referência do fornecedor gravada).');
  };
  const imprimirAnalise = () => {
    const win = window.open('', '_blank', 'width=1000,height=700');
    if (!win || !refAnalise.current || !analise) return;
    imprimirPagina(win, refAnalise.current, `Produtos da NF ${analise.numero} — ${analise.razao}`, undefined, true);
  };
  const alternar = (ch: string) => setSel((s) => { const n = new Set(s); if (n.has(ch)) n.delete(ch); else n.add(ch); return n; });

  const verEventos = async (chave: string) => {
    try {
      const r = await req<{ linhas: Linha[] }>(`/compras/manifesto-dfe/eventos/${chave}`);
      setEventos(r.linhas); setChaveEv(chave);
    } catch (e) { mensagem.erro(e); }
  };

  const ignorar = async (l: Linha) => {
    const ig = l.ignorada === 'S';
    const motivo = ig ? null : window.prompt('Motivo para ignorar esta NF-e (obrigatório):');
    if (!ig && !motivo?.trim()) return;
    try {
      await post('/compras/manifesto-dfe/ignorar', { codnfe_naocad: l.codigo, motivo: motivo ?? undefined, reverter: ig });
      mensagem.sucesso(ig ? 'NF-e devolvida à fila.' : 'NF-e ignorada.');
      void consultar();
    } catch (e) { mensagem.erro(e); }
  };

  const sincronizar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await post<{ lotes: number; resumos: number; completas: number; eventos: number }>('/compras/manifesto-dfe/sincronizar', {});
      mensagem.sucesso(`SEFAZ consultada: ${r.resumos} resumos, ${r.completas} notas completas, ${r.eventos} eventos.`);
      void consultar();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const importar = async (l: Linha) => {
    try {
      const r = await post<{ ja_importada: boolean; codnf?: number }>(`/compras/manifesto-dfe/importar/${l.codigo}`, {});
      mensagem.sucesso(r.ja_importada ? `Esta NF-e já estava importada (NF ${r.codnf}).` : 'NF-e importada para o sistema.');
      void consultar();
    } catch (e) { mensagem.erro(e); }
  };

  const abrirPrevisao = async (l: Linha) => {
    try {
      const sug = await req<Sugestao>(`/compras/manifesto-dfe/previsao-apagar/${l.codigo}`);
      setPrev({ cod: Number(l.codigo), sug, parcelas: sug.parcelas.map((p) => ({ nrparcela: p.nrparcela, valor: String(p.valor), dtvenc: p.dtvenc ?? '' })) });
    } catch (e) { mensagem.erro(e); }
  };

  const editarParcela = (i: number, campo: keyof ParcelaEd, v: string) =>
    setPrev((s) => (s ? { ...s, parcelas: s.parcelas.map((p, k) => (k === i ? { ...p, [campo]: v } : p)) } : s));

  const gerarPrevisao = async () => {
    if (!prev || busy) return;
    setBusy(true);
    try {
      const r = await post<{ titulos: number[]; total: number }>(`/compras/manifesto-dfe/previsao-apagar/${prev.cod}`, {
        parcelas: prev.parcelas.map((p) => ({ nrparcela: p.nrparcela, valor: Number(String(p.valor).replace(',', '.')), dtvenc: p.dtvenc })),
      });
      mensagem.sucesso(`Previsão gerada: ${r.titulos.length} título(s) de contas a pagar, ${brl(r.total)}.`);
      setPrev(null);
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const baixarXml = async (chave: string) => {
    try {
      const r = await req<{ xml: string }>(`/compras/manifesto-dfe/xml/${chave}`);
      const blob = new Blob([r.xml ?? ''], { type: 'application/xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${chave}.xml`; a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { mensagem.erro(e); }
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Manifesto do Destinatário (DF-e)" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-44"><Field label="C&NPJ do emitente" value={cnpj} onChange={(e) => setCnpj(e.target.value)} /></div>
        <div className="w-56"><Field label="C&have (final)" value={chave} onChange={(e) => setChave(e.target.value.replace(/\D/g, ''))} placeholder="os últimos dígitos" /></div>
        <div className="w-40"><Field label="&Emissão de" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="&até" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <div className="w-56"><Field label="&Fornecedor" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="parte da razão social" /></div>
        <div className="w-44"><SelectField label="&Mostrar" value={canceladas} onChange={setCanceladas} options={[
          { value: 'TODOS', label: 'Todas' }, { value: 'CANCELADAS', label: 'Apenas canceladas' }, { value: 'NAO_CANCELADAS', label: 'Apenas não canceladas' },
        ]} /></div>
        <label className="flex items-center gap-gp-xs pb-pad-xs text-body-sm">
          <input type="checkbox" checked={pendentes} onChange={(e) => setPendentes(e.target.checked)} />
          Só não importadas
        </label>
        <Button label="&Pesquisar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        <Button label="&Buscar notas (SEFAZ)" variant="soft" disabled={busy} onClick={() => void sincronizar()} />
        <small className="w-full text-fg-muted">
          As NF-e da loja nos últimos dias do manifesto (as cadastradas e as que a SEFAZ trouxe). <b className="text-danger">Vermelho</b> = cancelada;
          <b> negrito</b> = não importada; <b className="text-success">verde</b> = processada. As manifestações vão para as notas marcadas.
        </small>
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {[
            { rot: 'Notas', val: String(totais.linhas) },
            { rot: 'Não importadas', val: String(totais.pendentes), dg: Number(totais.pendentes) > 0 },
            { rot: 'Canceladas', val: String(totais.canceladas) },
            { rot: 'Total', val: brl(totais.total) },
          ].map((k) => (
            <div key={k.rot} className="flex-1 min-w-32 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.rot}</div>
              <div className={`text-title-sm font-bold tabular-nums ${(k as any).dg ? 'text-danger' : ''}`}>{k.val}</div>
            </div>
          ))}
        </div>
      )}

      {linhas.length > 0 && (
        <div className="flex flex-wrap items-center gap-gp-sm">
          <span className="text-body-sm">Marcadas: <b>{sel.size}</b></span>
          <Button label="&Ciência da operação" variant="soft" disabled={busy || !sel.size} onClick={() => void manifestarMarcadas('CIENCIA')} />
          <Button label="Con&firmar operação" variant="soft" disabled={busy || !sel.size} onClick={() => void manifestarMarcadas('CONFIRMACAO')} />
          <Button label="&Desconhecer operação" variant="soft" disabled={busy || !sel.size} onClick={() => void manifestarMarcadas('DESCONHECIMENTO')} />
          <Button label="Operação &não realizada" variant="soft" disabled={busy || !sel.size} onClick={() => void manifestarMarcadas('OPERACAO_NAO_REALIZADA')} />
        </div>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full min-w-[1400px] text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs"><input type="checkbox" aria-label="Marcar todas" checked={linhas.length > 0 && sel.size === linhas.length} onChange={(e) => setSel(e.target.checked ? new Set(linhas.map((l) => String(l.chave))) : new Set())} /></th>
              <th className="p-pad-xs">Importada</th><th className="p-pad-xs">Processada</th>
              <th className="p-pad-xs">Ciência</th><th className="p-pad-xs">Confirmação</th><th className="p-pad-xs">Tipo</th>
              <th className="p-pad-xs">Cód. NF</th><th className="p-pad-xs">Nro. NF</th><th className="p-pad-xs">Emissão</th>
              <th className="p-pad-xs">CNPJ</th><th className="p-pad-xs">Razão</th><th className="p-pad-xs">Processo atual</th>
              <th className="p-pad-xs">Chave</th><th className="p-pad-xs text-right">Total NF</th>
              <th className="p-pad-xs">Não realizada</th><th className="p-pad-xs">Desconhec.</th><th className="p-pad-xs">Cancelada</th>
              <th className="p-pad-xs">Outros</th><th className="p-pad-xs">Contingência</th><th className="p-pad-xs">Ações</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const ch = String(l.chave);
              const naoCad = l.cadastrada === 'NAO';
              // dbGridNotasFiscais…CustomDrawCell: cancelada vermelho negrito; não importada negrito; processada verde negrito
              const cor = l.cancelamento === 'SIM' ? 'text-danger font-semibold' : naoCad ? 'font-semibold' : l.processada === 'SIM' ? 'text-success font-semibold' : '';
              return (
                <tr key={`${ch}-${String(l.cadastrada)}`} className={`border-t border-border ${cor} ${sel.has(ch) ? 'bg-bg-subtle' : ''}`}>
                  <td className="p-pad-xs"><input type="checkbox" aria-label="Marcar" checked={sel.has(ch)} onChange={() => alternar(ch)} /></td>
                  <td className="p-pad-xs">{String(l.cadastrada)}{l.ignorada === 'S' ? <span className="block text-body-xs text-fg-muted" title={String(l.ignorar_manifesto_motivo ?? '')}>ignorada</span> : null}</td>
                  <td className="p-pad-xs">{String(l.processada)}</td>
                  <td className="p-pad-xs">{String(l.ciencia)}</td><td className="p-pad-xs">{String(l.confirmacao)}</td>
                  <td className="p-pad-xs">{String(l.tipo)}</td>
                  <td className="p-pad-xs tabular-nums">{naoCad ? '' : String(l.codigo)}</td>
                  <td className="p-pad-xs tabular-nums">{String(l.numero_nf ?? '')}</td>
                  <td className="p-pad-xs tabular-nums">{dia(l.data_emissao)}</td>
                  <td className="p-pad-xs tabular-nums">{String(l.cnpj_cpf ?? '')}</td>
                  <td className="p-pad-xs">{String(l.razao ?? '—')}{l.vincula_ent_dev === 'SIM' ? <span className="block text-body-xs text-fg-muted" title={String(l.cod_vincula_ent_dev ?? '')}>vinculada à devolução</span> : null}</td>
                  <td className="p-pad-xs">{String(l.processo_atual ?? '').trim() && String(l.processo_atual).trim() !== '-'
                    ? <button className="underline" onClick={() => navigate(`/fiscal/nf-esteira?chave=${ch}`)}>{String(l.processo_atual)}</button> : String(l.processo_atual ?? '')}</td>
                  <td className="p-pad-xs tabular-nums text-body-xs">{ch}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(l.total_nf)}</td>
                  <td className="p-pad-xs">{String(l.naorealizada)}</td><td className="p-pad-xs">{String(l.desconhecimento)}</td>
                  <td className="p-pad-xs">{String(l.cancelamento)}</td><td className="p-pad-xs">{String(l.outros_eventos)}</td>
                  <td className="p-pad-xs">{String(l.contingencia)}</td>
                  <td className="p-pad-xs whitespace-nowrap">
                    <button className="underline" onClick={() => void verEventos(ch)}>eventos</button>
                    {l.tipo === 'ENTRADA' && <>{' · '}<button className="underline" onClick={() => void analisarItens(ch)}>itens</button></>}
                    {l.tem_xml === true && <>{' · '}<button className="underline" onClick={() => void baixarXml(ch)}>xml</button></>}
                    {naoCad && <>{' · '}<button className="underline" onClick={() => void ignorar(l)}>{l.ignorada === 'S' ? 'reverter' : 'ignorar'}</button></>}
                    {naoCad && l.ignorada !== 'S' && <>{' · '}<button className="underline" onClick={() => void importar(l)}>importar</button></>}
                    {naoCad && l.ignorada !== 'S' && l.cancelamento !== 'SIM' && <>{' · '}<button className="underline" onClick={() => void abrirPrevisao(l)}>previsão a pagar</button></>}
                    {/* os botões da grade com a nota cadastrada: a conferência da nota (TfrmConferenciaNota) */}
                    {!naoCad && <>{' · '}<button className="underline" onClick={() => navigate(`/compras/conferencia-nota?codnf=${String(l.codigo)}`)}>conferência</button></>}
                  </td>
                </tr>
              );
            })}
            {!linhas.length && <tr><td colSpan={20} className="p-pad-md text-fg-muted">Pesquise para listar as NF-e.</td></tr>}
          </tbody>
        </table>
      </div>

      {log.length > 0 && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="mb-gp-xs flex items-center justify-between"><strong className="text-body-sm">Log</strong><button className="text-body-sm underline" onClick={() => setLog([])}>limpar</button></div>
          <table className="w-full text-body-sm">
            <tbody>
              {log.map((l, i) => (
                <tr key={i} className={`border-t border-border ${l.tipo === 'E' ? 'text-danger' : ''}`}>
                  <td className="p-pad-xs w-8">{l.tipo}</td><td className="p-pad-xs tabular-nums text-body-xs">{l.chave}</td><td className="p-pad-xs">{l.descricao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {analise && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex flex-wrap items-baseline gap-gp-sm">
            <strong>Itens da NF {analise.numero} — {analise.razao}</strong>
            <span className="text-body-sm tabular-nums">{analise.cnpj}</span>
            <span className={`text-body-sm font-semibold ${analise.parceiro.status === 'ATIVO' ? 'text-accent' : 'text-danger'}`}>{STATUS_PARCEIRO[analise.parceiro.status]}</span>
            <span className="text-body-sm">Total {brl(analise.total)}</span>
            {!analise.editavel && <span className="text-body-sm text-fg-muted">nota processada — fator só leitura</span>}
          </div>
          <div className="flex flex-wrap items-center gap-gp-sm">
            <SelectField label="Mo&strar" value={filtroItens} onChange={(v) => setFiltroItens((v || 'T') as 'T' | 'S' | 'N')} options={[{ value: 'T', label: 'Todos' }, { value: 'S', label: 'Produtos cadastrados' }, { value: 'N', label: 'Produtos não cadastrados' }]} />
            <Button label="&Gravar fatores" variant="soft" disabled={busy || !analise.editavel} onClick={() => void gravarFatores()} />
            <Button label="Fator &original a todos" variant="ghost" disabled={busy || !analise.editavel} onClick={() => void acaoAnalise('fator-todos', { modo: 'original' }, 'Produtos atualizados com sucesso!')} />
            <Button label="Fator &1,0 a todos" variant="ghost" disabled={busy || !analise.editavel} onClick={() => void acaoAnalise('fator-todos', { modo: 'unitario' }, 'Produtos atualizados com sucesso!')} />
            <Button label="Im&primir" variant="ghost" onClick={imprimirAnalise} />
            <Button label="&Fechar" variant="ghost" onClick={() => setAnalise(null)} />
          </div>
          <div ref={refAnalise} className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-body-sm">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className="p-pad-xs">Item</th><th className="p-pad-xs">Cód. forn.</th><th className="p-pad-xs">EAN</th><th className="p-pad-xs">Descrição</th>
                  <th className="p-pad-xs">NCM</th><th className="p-pad-xs">CFOP</th><th className="p-pad-xs">Un.</th><th className="p-pad-xs text-right">Qtde</th>
                  <th className="p-pad-xs text-right">Fator</th><th className="p-pad-xs text-right">Vr. unit.</th><th className="p-pad-xs text-right">Vr. total</th>
                  <th className="p-pad-xs text-right">Unit. c/ ST e IPI</th><th className="p-pad-xs">Produto</th>
                </tr>
              </thead>
              <tbody>
                {analise.itens.filter((i) => filtroItens === 'T' || i.produto_cadastrado === filtroItens).map((i) => (
                  <tr key={i.nroitem} className={`border-t border-border ${i.produto_cadastrado === 'N' ? 'text-danger' : ''}`}>
                    <td className="p-pad-xs tabular-nums">{i.nroitem}</td><td className="p-pad-xs">{i.codprod}</td><td className="p-pad-xs tabular-nums">{i.ean}</td>
                    <td className="p-pad-xs">{i.descricao}</td><td className="p-pad-xs tabular-nums">{i.ncm}</td><td className="p-pad-xs tabular-nums">{i.cfop ?? ''}</td>
                    <td className="p-pad-xs">{i.unidade}</td><td className="p-pad-xs text-right tabular-nums">{i.quantidade.toLocaleString('pt-BR')}</td>
                    <td className="p-pad-xs text-right">{analise.editavel
                      ? <input aria-label={`Fator do item ${i.nroitem}`} className="w-16 rounded-radius-sm border border-border bg-bg px-1 py-0.5 text-right tabular-nums" inputMode="decimal" value={fatores[i.nroitem] ?? ''} onChange={(e) => setFatores((f) => ({ ...f, [i.nroitem]: e.target.value }))} />
                      : <span className="tabular-nums">{i.fatorembal.toLocaleString('pt-BR')}</span>}</td>
                    <td className="p-pad-xs text-right tabular-nums">{brl(i.vrunitario)}</td><td className="p-pad-xs text-right tabular-nums">{brl(i.vrtotal)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{brl(i.vrunitario_trib)}</td>
                    <td className="p-pad-xs">{i.produto_cadastrado === 'S'
                      ? <span>{i.idproduto} · {i.produto_codbarra ?? ''} · {i.produto_descricao ?? ''}</span>
                      : <span>não cadastrado{analise.parceiro.codparceiro != null && <>{' · '}<button className="underline" onClick={() => vincularItem(i)}>vincular</button></>}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {prev && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex flex-col">
            <strong>Previsão de contas a pagar — NF {prev.sug.nronf} · {prev.sug.fornecedor ?? prev.sug.razao ?? ''}</strong>
            <small className="text-fg-muted">Origem: {FONTE[prev.sug.fonte]}. Um título por parcela, sem movimentar o caixa; ao faturar a nota, a previsão vira o título.</small>
            {prev.sug.jaGerada && <small className="text-fg-danger">Já existe previsão em aberto para esta nota.</small>}
            {!prev.sug.configurado && <small className="text-fg-danger">A geração não está configurada (situação e centro de custo da previsão do manifesto).</small>}
            {prev.sug.codparceiro == null && <small className="text-fg-danger">O fornecedor da nota não está cadastrado.</small>}
          </div>
          <div className="overflow-x-auto">
            <table className="text-body-sm">
              <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs">Parcela</th><th className="p-pad-xs">Valor</th><th className="p-pad-xs">Vencimento</th><th className="p-pad-xs" /></tr></thead>
              <tbody>
                {prev.parcelas.map((p, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-pad-xs w-28"><Field label="" aria-label={`Parcela ${i + 1}`} value={p.nrparcela} onChange={(e) => editarParcela(i, 'nrparcela', e.target.value)} /></td>
                    <td className="p-pad-xs w-36"><Field label="" aria-label={`Valor da parcela ${i + 1}`} inputMode="decimal" value={p.valor} onChange={(e) => editarParcela(i, 'valor', e.target.value)} /></td>
                    <td className="p-pad-xs w-44"><Field label="" aria-label={`Vencimento da parcela ${i + 1}`} type="date" value={p.dtvenc} onChange={(e) => editarParcela(i, 'dtvenc', e.target.value)} /></td>
                    <td className="p-pad-xs">{prev.parcelas.length > 1 && <button className="underline" onClick={() => setPrev((s) => (s ? { ...s, parcelas: s.parcelas.filter((_, k) => k !== i) } : s))}>remover</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-gp-sm">
            <Button label="&Adicionar parcela" variant="soft" onClick={() => setPrev((s) => (s ? { ...s, parcelas: [...s.parcelas, { nrparcela: String(s.parcelas.length + 1).padStart(3, '0'), valor: '', dtvenc: '' }] } : s))} />
            <Button label="&Gerar previsão" disabled={busy || prev.sug.jaGerada || !prev.sug.configurado || prev.sug.codparceiro == null} onClick={() => void gerarPrevisao()} />
            <Button label="&Fechar" variant="soft" onClick={() => setPrev(null)} />
          </div>
        </section>
      )}

      {eventos && (
        <>
          <div className="text-body-sm font-semibold">Eventos da chave {chaveEv}</div>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className="p-pad-xs">Data</th><th className="p-pad-xs">Tipo</th><th className="p-pad-xs">Sequência</th>
                  <th className="p-pad-xs">Descrição</th><th className="p-pad-xs">Protocolo</th><th className="p-pad-xs">Justificativa</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((e, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-pad-xs tabular-nums">{dia(e.data_evento)}</td>
                    <td className="p-pad-xs tabular-nums">{String(e.tipo_evento)}</td>
                    <td className="p-pad-xs tabular-nums">{String(e.seq_evento ?? '')}</td>
                    <td className="p-pad-xs">{String(e.descricao_evento ?? '—')}</td>
                    <td className="p-pad-xs tabular-nums">{String(e.protocolo_autorizacao ?? '—')}</td>
                    <td className="p-pad-xs">{String(e.just_op_nao_realizada ?? '')}</td>
                  </tr>
                ))}
                {!eventos.length && <tr><td colSpan={6} className="p-pad-md text-fg-muted">Sem eventos.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
