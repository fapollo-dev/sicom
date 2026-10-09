import { useEffect, useState, type KeyboardEvent } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { Button } from '../../shared/ui/Button';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useMensagem } from '../../shared/mensagem';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { HistoricoDinamicoModal } from '../../shared/log/HistoricoDinamicoModal';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';
import { Modal } from '../../shared/ui/Modal';
import { DateField } from '../../shared/ui/DateField';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: (body as any)?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as T;
}

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: unknown) => `${(Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Painel {
  vrcustoreal: number; vrcustorep: number; vrcustocsi: number; creditoicm: number; creditopiscofins: number;
  pmz: number; vrvendasug: number; markup: number; vrvenda: number;
  debitoicm: number; debitopiscofins: number; vendaliq: number; lucrobrutov: number; lucrobrutop: number;
  despopv: number; lucroliqv: number; lucroliqp: number; imprend: number; contsocial: number;
  margeml2v: number; margeml2: number; markdown: number;
}
interface Comp {
  vrcusto: number; icme?: number; ipi?: number; frete?: number; frete2?: number; seguro?: number; icmst?: number; vrfcpst?: number;
  despacessorio?: number; vrcustoajuste?: number; bonificacao?: number; fcp_saida?: number;
}
interface Linha {
  markupfixo?: number; ativo: string; ativo_compra: string; promocao: string; vrpromo?: number; atacarejo_ativo: string;
  margem_comissao?: number; comissao?: number; usa_flex: string; prod_exibe_forca_vendas: string;
}
interface Abertura {
  produto: { idproduto: number; codbarra?: string; descricao?: string; codgrupopreco?: number | null; grupo_preco?: string | null };
  preco: Record<string, unknown>; empresas: Array<{ idempresa: number; fantasia?: string; qtde?: number }>; painel: Painel; modo_lote_default: boolean;
  idempresa: number; promocao_acumulativa?: boolean; sem_preco?: boolean;
  fiscal: { icm_efetivo: number; despoperacional: number; imprenda: number; contsocial: number; simples: boolean };
  config: { tipo_precificacao: string; permite_promocao: boolean; habilita_atacarejo: boolean; sincroniza_empresas: boolean };
}
const n = (v: unknown) => Number(v ?? 0);
const sn = (v: unknown, padrao = 'S') => (v == null || v === '' ? padrao : String(v));

/**
 * PRECIFICAÇÃO DE MERCADORIAS (`FRMPRIFICACAOCUSTO`, UPrificacaoCusto.pas) — a linha de preço de um produto numa loja: os componentes do
 * custo, os impostos de entrada e de saída, as bases (reposição, C.S.I, P.M.Z), a margem, a venda sugerida e a praticada, a escada até o
 * lucro final, e os campos da linha (markup fixo, promoção, ativo, ativo compra, atacarejo, comissão, flex, força de vendas). Dossiê
 * `UPrificacaoCusto.md`.
 *  - O campo do produto recebe o código de barras (o do produto ou o código auxiliar — GetProduto); F3 pesquisa a GET_PRODUTOS da loja
 *    com o " Ativo venda / compra" da tela; com promoção acumulativa na loja do login a venda trava ("Produto em promoção acumulativa").
 *  - Outros → Multi-Preço: o histórico do MULTI_PRECO do produto na loja da linha.
 *  - "Sinc. Custo na venda" (Tag 1): o custo da tela retroage às vendas do produto na loja da linha, no período informado.
 *  - A grade de empresas escolhe a loja EDITADA (a linha) e marca as lojas da sincronização; "T" marca todas, Espaço marca a da linha.
 *  - " Opcao de atualização": Individual (o padrão — só a loja da linha) ou Sincronizar empresas marcadas; "Atualizar preços": On-line ou
 *    Gerar lote (o padrão da loja com PRECONF = L).
 *  - Margem + Enter calcula a venda sobre o custo real (`edtMARKUPKeyDown`: VRCUSTOREAL × (1 + margem%)).
 *  - Os controles com permissão (Tag 1): a venda (EDTVRVENDA), o markup fixo, o ativo, o ativo compra e o Gravar.
 */
export function PrecificacaoCustoPage() {
  const mensagem = useMensagem();
  const { tem: pode } = useOpcoesDoForm('FRMPRIFICACAOCUSTO');
  const [busca, setBusca] = useState('');
  const [ab, setAb] = useState<Abertura | null>(null);
  const [comp, setComp] = useState<Comp>({ vrcusto: 0 });
  const [linha, setLinha] = useState<Linha | null>(null);
  const [markup, setMarkup] = useState<number | undefined>();
  const [venda, setVenda] = useState<number | undefined>();
  const [painel, setPainel] = useState<Painel | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [lote, setLote] = useState(false);
  const [opcao, setOpcao] = useState<'individual' | 'sincronizar'>('individual');
  const [busy, setBusy] = useState(false);
  const [outrosAberto, setOutrosAberto] = useState(false);
  // o rdgAtivo " Ati&vo venda / compra" (Sim — o padrão —, Não, Todos): o filtro da Pesquisa do F3
  const [ativoVC, setAtivoVC] = useState<'S' | 'N' | 'T'>('S');
  const [pesquisa, setPesquisa] = useState(false);
  // "Sinc. Custo na venda": o frmRetornaInfo (data inicial e final) e a confirmação
  const [sinc, setSinc] = useState<{ etapa: 'datas' | 'confirmar'; dtini?: string; dtfim?: string } | null>(null);
  const [multiPreco, setMultiPreco] = useState(false);

  // AbreProduto (:386-460) e dtsEmpresaDataChange (:1749-1790): a linha de preço da loja escolhida
  const abrir = async (id: number, idempresa?: number, manterSel = false) => {
    setBusy(true);
    try {
      const a = await req<Abertura>(`/precificacao/custo/${id}${idempresa ? `?idempresa=${idempresa}` : ''}`);
      setAb(a); setPainel(a.painel);
      const p = a.preco;
      setComp({ vrcusto: n(p.vrcusto), icme: n(p.icme), ipi: n(p.ipi), frete: n(p.frete), frete2: n(p.frete2), seguro: n(p.seguro), icmst: n(p.icmst),
        vrfcpst: n(p.vrfcpst), despacessorio: n(p.despacessorio), vrcustoajuste: n(p.vrcustoajuste), bonificacao: n(p.bonificacao), fcp_saida: n(p.fcp_saida) });
      setLinha({ markupfixo: n(p.markupfixo), ativo: sn(p.ativo), ativo_compra: sn(p.ativo_compra), promocao: sn(p.promocao, 'N'), vrpromo: n(p.vrpromo),
        atacarejo_ativo: sn(p.atacarejo_ativo, 'N'), margem_comissao: n(p.margem_comissao), comissao: n(p.comissao), usa_flex: sn(p.usa_flex, 'N'),
        prod_exibe_forca_vendas: sn(p.prod_exibe_forca_vendas, 'N') });
      setMarkup(n(p.markup)); setVenda(n(p.vrvenda));
      // ao abrir o produto todas as lojas vêm marcadas (:419-430); trocar de linha não mexe nas marcas
      if (!manterSel) { setSel(new Set(a.empresas.map((e) => e.idempresa))); setLote(a.modo_lote_default); }
      if (a.config.sincroniza_empresas) setOpcao('sincronizar');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  // edtCodProdExit → AbreProduto: o campo recebe o código de barras (GetProduto: o do produto e, sem ele, o código auxiliar)
  const buscarCodigo = async () => {
    const codigo = busca.trim();
    if (!codigo) return;
    try {
      const { idproduto } = await req<{ idproduto: number }>(`/precificacao/custo/produto/${encodeURIComponent(codigo)}`);
      await abrir(idproduto);
    } catch (e) { mensagem.erro(e); }
  };

  // aberta pelo cadastro de produto (PrecificaodoCusto1Click: `edtCodProd.Text := CODBARRA`) — `?codbarra=`
  useEffect(() => {
    const cb = new URLSearchParams(window.location.search).get('codbarra');
    if (!cb) return;
    setBusca(cb);
    void (async () => {
      try { const { idproduto } = await req<{ idproduto: number }>(`/precificacao/custo/produto/${encodeURIComponent(cb)}`); await abrir(idproduto); } catch (e) { mensagem.erro(e); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recalcular = async (patch: Partial<Comp> = {}, mk = markup, vd = venda) => {
    if (!ab) return;
    const c = { ...comp, ...patch };
    setComp(c);
    try {
      setPainel(await req<Painel>('/precificacao/custo/calcular', { method: 'POST',
        body: JSON.stringify({ ...c, idproduto: ab.produto.idproduto, idempresa: ab.idempresa, markup: mk ?? 0, vrvenda: vd ?? 0 }) }));
    } catch (e) { mensagem.erro(e); }
  };
  // Margem + Enter (`edtMARKUPKeyDown`, :1949-1968): a venda praticada = custo real × (1 + margem%)
  const margemEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !painel || !pode('EDTVRVENDA')) return;
    const v = Math.round(painel.vrcustoreal * (1 + n(markup) / 100) * 100) / 100;
    setVenda(v); void recalcular({}, markup, v);
  };

  const gravar = async () => {
    if (!ab || !linha || busy) return;
    if (linha.promocao === 'S' && ab.config.permite_promocao && !(n(linha.vrpromo) > 0)) { mensagem.erro(new Error('Valor promoção não poder ser Zero.')); return; }
    setBusy(true);
    try {
      const r = await req<{ lotes: number; historico: number; precoMantido: Array<{ idempresa: number; motivo: string }> }>('/precificacao/custo/salvar', {
        method: 'POST',
        body: JSON.stringify({ ...comp, ...linha, idproduto: ab.produto.idproduto, empresas: [...sel], empresaEditada: ab.idempresa, opcao,
          markup: markup ?? 0, vrvenda: venda ?? 0, modoLote: lote }),
      });
      const motivo: Record<string, string> = { lote: 'o preço foi para o lote', promocao_acumulativa: 'produto em promoção acumulativa', sem_permissao: 'sem permissão para alterar a venda' };
      const notas = r.precoMantido.map((m) => `loja ${m.idempresa}: ${motivo[m.motivo] ?? m.motivo}`);
      mensagem.sucesso(['Alterações realizadas com sucesso.', ...(r.lotes ? [`${r.lotes} lote(s) de preço gerado(s).`] : []), ...notas].join(' '));
      await abrir(ab.produto.idproduto, ab.idempresa, true);
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  // btnSincCustoNaVendaClick (:462-482): o custo da tela retroage às vendas do produto na loja da linha, no período
  const sincronizarCusto = async () => {
    if (!ab || !sinc?.dtini || !sinc.dtfim) return;
    setBusy(true);
    try {
      const r = await req<{ vendas: number }>('/precificacao/custo/sinc-custo-venda', { method: 'POST',
        body: JSON.stringify({ idproduto: ab.produto.idproduto, idempresa: ab.idempresa, vrcusto: comp.vrcusto, dtini: sinc.dtini, dtfim: sinc.dtfim }) });
      setSinc(null);
      mensagem.sucesso(`Custo sincronizado em ${r.vendas} venda(s).`);
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  const ddmmaa = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : '');

  const tipo = ab?.config.tipo_precificacao ?? 'P';
  const rotuloFixo = tipo === 'D' ? 'Markdown fixo %' : tipo === 'M' ? 'Margem fixa %' : 'Markup Fixo %';
  const editavelLinha = (campo: keyof Linha, v: unknown) => setLinha((l) => (l ? { ...l, [campo]: v } : l));
  const valor = (rot: string, v: unknown, cls = '') => (
    <div className={`flex justify-between border-b border-border py-0.5 ${cls}`}><span className="text-fg-muted">{rot}</span><span className="tabular-nums">{brl(v)}</span></div>
  );
  const valorPct = (rot: string, p: unknown, v: unknown, cls = '') => (
    <div className={`grid grid-cols-[1fr_5rem_6rem] border-b border-border py-0.5 ${cls}`}><span className="text-fg-muted">{rot}</span>
      <span className="text-right tabular-nums">{p == null ? '' : `${pct(p)}%`}</span><span className="text-right tabular-nums">{brl(v)}</span></div>
  );
  // dbgEmpresasKeyDown/KeyUp (:1672-1725): T marca todas (não com a sincronização forçada), Espaço marca a da linha
  const teclasGrade = (e: KeyboardEvent, id: number) => {
    if ((e.key === 't' || e.key === 'T') && !ab?.config.sincroniza_empresas) { e.preventDefault(); setSel(new Set(ab?.empresas.map((x) => x.idempresa) ?? [])); }
    if (e.key === ' ') { e.preventDefault(); setSel((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; }); }
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Precificação de Mercadorias" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-48"><Field label="&Produto" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="cód. barras + Enter · F3"
          onKeyDown={(e) => { if (e.key === 'Enter') void buscarCodigo(); if (e.key === 'F3') { e.preventDefault(); setPesquisa(true); } }} /></div>
        <Button label="Pesquisar [F3]" variant="ghost" onClick={() => setPesquisa(true)} />
        <fieldset className="flex items-center gap-gp-sm text-body-sm">
          <legend className="text-caption text-fg-muted">Ativo venda / compra</legend>
          {([['S', 'Sim'], ['N', 'Não'], ['T', 'Todos']] as const).map(([v, r]) => (
            <label key={v} className="flex items-center gap-1"><input type="radio" name="ativo-vc" checked={ativoVC === v} onChange={() => setAtivoVC(v)} /> {r}</label>
          ))}
        </fieldset>
        {ab && (
          <div className="flex flex-1 flex-wrap gap-gp-md text-body-sm">
            <span><span className="text-fg-muted">Código </span><b className="tabular-nums">{ab.produto.idproduto}</b></span>
            <span><span className="text-fg-muted">Cód. barras </span>{ab.produto.codbarra ?? ''}</span>
            <span className="font-semibold">{ab.produto.descricao}</span>
            <span><span className="text-fg-muted">Grupo de Preço </span>{ab.produto.codgrupopreco ? `${ab.produto.codgrupopreco} - ${ab.produto.grupo_preco ?? ''}` : '—'}</span>
            {ab.sem_preco && <span className="text-fg-muted">Sem preço na loja {ab.idempresa} — o Gravar inclui.</span>}
          </div>
        )}
      </div>

      {ab && painel && linha && (
        <div className="grid grid-cols-1 gap-gp-md lg:grid-cols-[18rem_1fr_1fr_1fr]">
          <div className="rounded-radius-md border border-border bg-bg-surface text-body-sm">
            <div className="border-b border-border p-pad-xs font-semibold text-fg-muted">&Empresas</div>
            <table className="w-full">
              <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs w-8" /><th className="p-pad-xs">Código</th><th className="p-pad-xs">Fantasia</th><th className="p-pad-xs text-right">Estoque</th></tr></thead>
              <tbody>
                {ab.empresas.map((e) => (
                  <tr key={e.idempresa} tabIndex={0} onKeyDown={(k) => teclasGrade(k, e.idempresa)} onClick={() => { if (e.idempresa !== ab.idempresa) void abrir(ab.produto.idproduto, e.idempresa, true); }}
                    className={`cursor-pointer border-t border-border ${e.idempresa === ab.idempresa ? 'bg-bg-subtle font-semibold' : ''}`}>
                    <td className="p-pad-xs" onClick={(c) => c.stopPropagation()}>
                      {/* com a sincronização forçada (SINCRONIZA_PRECIFICACAO_EMPRESAS) a marca some e todas sincronizam (:1264-1275) */}
                      {!ab.config.sincroniza_empresas && <input type="checkbox" aria-label={`Marcar a empresa ${e.idempresa}`} checked={sel.has(e.idempresa)}
                        onChange={() => setSel((s) => { const x = new Set(s); x.has(e.idempresa) ? x.delete(e.idempresa) : x.add(e.idempresa); return x; })} />}
                    </td>
                    <td className="p-pad-xs tabular-nums">{e.idempresa}</td><td className="p-pad-xs">{e.fantasia ?? ''}</td>
                    <td className="p-pad-xs text-right tabular-nums">{Number(e.qtde ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-col gap-gp-xs border-t border-border p-pad-xs">
              <span className="font-semibold text-fg-muted">Atualizar preços :</span>
              <label className="flex items-center gap-1"><input type="radio" name="atualizar" checked={!lote} onChange={() => setLote(false)} /> On-line</label>
              <label className="flex items-center gap-1"><input type="radio" name="atualizar" checked={lote} onChange={() => setLote(true)} /> Gerar lote</label>
              <span className="mt-gp-xs font-semibold text-fg-muted">Opcao de atualização</span>
              <label className="flex items-center gap-1"><input type="radio" name="opcao" checked={opcao === 'individual'} disabled={ab.config.sincroniza_empresas} onChange={() => setOpcao('individual')} /> Individual</label>
              <label className="flex items-center gap-1"><input type="radio" name="opcao" checked={opcao === 'sincronizar'} disabled={ab.config.sincroniza_empresas} onChange={() => setOpcao('sincronizar')} /> Sincronizar empresas marcadas</label>
            </div>
          </div>

          <div className="rounded-radius-md border border-border bg-bg-surface p-pad-md text-body-sm">
            <div className="mb-1 font-semibold text-fg-muted">Custo</div>
            <div className="grid grid-cols-2 gap-1">
              <div className="col-span-2"><NumberField label="C&usto" value={comp.vrcusto} decimais={4} onChange={(v) => void recalcular({ vrcusto: v ?? 0 })} /></div>
              <NumberField label="Desp. acessórias $" value={comp.despacessorio} decimais={2} onChange={(v) => void recalcular({ despacessorio: v ?? 0 })} />
              <NumberField label="Bonificacao (-) $" value={comp.bonificacao} decimais={6} onChange={(v) => void recalcular({ bonificacao: v ?? 0 })} />
              <NumberField label="Frete %" value={comp.frete} decimais={2} onChange={(v) => void recalcular({ frete: v ?? 0 })} />
              <NumberField label="IPI %" value={comp.ipi} decimais={2} onChange={(v) => void recalcular({ ipi: v ?? 0 })} />
              <NumberField label="Seguro %" value={comp.seguro} decimais={2} onChange={(v) => void recalcular({ seguro: v ?? 0 })} />
              <NumberField label="Frete ñ incluso %" value={comp.frete2} decimais={2} onChange={(v) => void recalcular({ frete2: v ?? 0 })} />
              <NumberField label="ICMST $" value={comp.icmst} decimais={2} onChange={(v) => void recalcular({ icmst: v ?? 0 })} />
              <NumberField label="FCP ST (Fundo. Comb.) $" value={comp.vrfcpst} decimais={2} onChange={(v) => void recalcular({ vrfcpst: v ?? 0 })} />
              <NumberField label="Ajuste custo (-/+) $" value={comp.vrcustoajuste} decimais={2} onChange={(v) => void recalcular({ vrcustoajuste: v ?? 0 })} />
              <NumberField label="Margem de Comissão %" value={linha.margem_comissao} decimais={2} onChange={(v) => editavelLinha('margem_comissao', v ?? 0)} />
              <NumberField label="Comissão (%)" value={linha.comissao} decimais={2} min={0} max={100} onChange={(v) => editavelLinha('comissao', v ?? 0)} />
              <CheckboxField label="Usa flex" value={linha.usa_flex} onChange={(v) => editavelLinha('usa_flex', v)} />
              <CheckboxField label="Exibe no força de vendas" value={linha.prod_exibe_forca_vendas} onChange={(v) => editavelLinha('prod_exibe_forca_vendas', v)} />
            </div>
            <div className="mt-2 font-semibold text-fg-muted">Imp. Entrada</div>
            <div className="grid grid-cols-2 items-end gap-1">
              <NumberField label="Crédito ICMS %" value={comp.icme} decimais={2} onChange={(v) => void recalcular({ icme: v ?? 0 })} />
              <span className="pb-1 text-right tabular-nums">{brl(painel.creditoicm)}</span>
            </div>
            {valor('Crédito PIS / COFINS', painel.creditopiscofins)}
            <div className="mt-2 font-semibold text-fg-muted">Imp. Saida</div>
            {valorPct('ICMS efetivo / Débito ICMS', ab.fiscal.icm_efetivo, painel.debitoicm)}
            <div className="grid grid-cols-2 items-end gap-1">
              <NumberField label="FCP Saida %" value={comp.fcp_saida} decimais={2} onChange={(v) => void recalcular({ fcp_saida: v ?? 0 })} />
              <span />
            </div>
            {valor('Débito PIS/COFINS', painel.debitopiscofins)}
          </div>

          <div className="rounded-radius-md border border-border bg-bg-surface p-pad-md text-body-sm">
            {valor('Custo Reposição:', painel.vrcustorep, 'font-semibold')}
            {valor('C.S.I', painel.vrcustocsi, 'font-semibold')}
            {tipo !== 'D' && valor('P.M.Z', painel.pmz, 'font-semibold')}
            <div className="mt-2 grid grid-cols-2 gap-1">
              <div onKeyDown={margemEnter}><NumberField label="Margem %" value={markup} decimais={2} onChange={(v) => { setMarkup(v); void recalcular({}, v, venda); }} /></div>
              <div className="flex flex-col justify-end"><span className="text-caption text-fg-muted">Venda Sugestão:</span><b className="tabular-nums">{brl(painel.vrvendasug)}</b></div>
              <NumberField label="&Venda praticada" value={venda} decimais={2} disabled={!pode('EDTVRVENDA') || !!ab.promocao_acumulativa} onChange={(v) => { setVenda(v); void recalcular({}, markup, v); }} />
              <NumberField label={`&${rotuloFixo}`} value={linha.markupfixo} decimais={2} disabled={!pode('EDTMARKUPFIXO')} onChange={(v) => editavelLinha('markupfixo', v ?? 0)} />
            </div>
            {ab.promocao_acumulativa && <p className="mt-1 font-semibold text-fg-danger">Produto em promoção acumulativa</p>}
            {valor('Markdown', painel.markdown)}
            <div className="mt-2 grid grid-cols-2 items-end gap-1">
              <CheckboxField label="Vl. Promoção" value={linha.promocao} disabled={!ab.config.permite_promocao} onChange={(v) => editavelLinha('promocao', v)} />
              <NumberField label="Valor da promoção" value={linha.vrpromo} decimais={2} disabled={!ab.config.permite_promocao || linha.promocao !== 'S'} onChange={(v) => editavelLinha('vrpromo', v ?? 0)} />
              <CheckboxField label="Ativo" value={linha.ativo} disabled={!pode('CHATIVO')} onChange={(v) => editavelLinha('ativo', v)} />
              <CheckboxField label="Ativo Compra" value={linha.ativo_compra} disabled={!pode('CHATIVOCOMPRA')} onChange={(v) => editavelLinha('ativo_compra', v)} />
              <CheckboxField label="Atacarejo Ativo" value={linha.atacarejo_ativo} disabled={!ab.config.habilita_atacarejo} onChange={(v) => editavelLinha('atacarejo_ativo', v)} />
            </div>
          </div>

          <div className="rounded-radius-md border border-border bg-bg-surface p-pad-md text-body-sm">
            {valor('Venda Liquida', painel.vendaliq)}
            {valorPct('Lucro Bruto', painel.lucrobrutop, painel.lucrobrutov)}
            {valorPct('Desp. Oper.', ab.fiscal.despoperacional, painel.despopv)}
            {valorPct('Lucro Liquido', painel.lucroliqp, painel.lucroliqv)}
            {valorPct('Imp. Renda', ab.fiscal.imprenda, painel.imprend)}
            {valorPct('Cont. Social', ab.fiscal.contsocial, painel.contsocial)}
            {valorPct('Lucro Final', painel.margeml2, painel.margeml2v, 'font-semibold')}
            <div className="relative mt-gp-md flex justify-end gap-gp-sm">
              {/* btnOutros / PopOutros: "Multi-Preço" (MultiPreo1Click). O "Atacarejo" (o histórico das faixas, MULTI_PRECO_ATACAREJO) fica
                  de fora: as faixas não são usadas — 1 linha de histórico em toda a produção, de 2024. */}
              <Button label="Sinc. Custo na venda" variant="ghost" disabled={busy || !pode('BTNSINCCUSTONAVENDA')} onClick={() => setSinc({ etapa: 'datas' })} />
              <Button label="&Outros" variant="ghost" onClick={() => setOutrosAberto((v) => !v)} />
              {outrosAberto && (
                <div role="menu" aria-label="Outros" className="absolute bottom-full right-0 z-40 mb-gp-xs flex w-48 flex-col rounded-radius-base border border-border bg-bg-surface shadow-sh-md">
                  <button type="button" role="menuitem" className="cursor-pointer border-0 bg-transparent px-pad-md py-gp-xs text-left text-body-sm text-fg-default hover:bg-bg-canvas"
                    onClick={() => { setOutrosAberto(false); setMultiPreco(true); }}>Multi-Preço</button>
                </div>
              )}
              <Button label="&Gravar" disabled={busy || !pode('BTNGRAVAR')} onClick={() => void gravar()} />
            </div>
          </div>
        </div>
      )}
      {/* btnBuscaProdutoClick: a GET_PRODUTOS da loja com o filtro do rdgAtivo; o código de barras volta ao campo e o produto abre */}
      {pesquisa && (
        <Pesquisa resourcePath="precificacao/produtos" parametros={{ ativoVendaCompra: ativoVC === 'T' ? '' : ativoVC }} onFechar={() => setPesquisa(false)}
          onSelecionar={(l) => { setPesquisa(false); setBusca(String(l.codbarra ?? '')); void abrir(Number(l.idproduto)); }} />
      )}
      {sinc?.etapa === 'datas' && (
        <Modal open onClose={() => setSinc(null)} size="sm" title="Informe a data"
          primaryAction={{ label: '&Confirma', onClick: () => { if (!sinc.dtini || !sinc.dtfim) { mensagem.erro(new Error('Informe a data inicial e a final.')); return; } setSinc({ ...sinc, etapa: 'confirmar' }); } }}
          secondaryAction={{ label: '&Sair', onClick: () => setSinc(null) }}>
          <div className="grid grid-cols-2 gap-gp-sm">
            <DateField label="Data inicial" value={sinc.dtini} onChange={(v) => setSinc({ ...sinc, dtini: v })} />
            <DateField label="Data final" value={sinc.dtfim} onChange={(v) => setSinc({ ...sinc, dtfim: v })} />
          </div>
        </Modal>
      )}
      {sinc?.etapa === 'confirmar' && (
        <Modal open onClose={() => setSinc(null)} size="sm" title="Sinc. Custo na venda"
          primaryAction={{ label: 'Sim', onClick: () => void sincronizarCusto() }} secondaryAction={{ label: 'Não', onClick: () => setSinc(null) }}>
          <p className="text-body-sm">Deseja retroagir o custo atual até a data de: {ddmmaa(sinc.dtini)}</p>
        </Modal>
      )}
      {/* MultiPreo1Click: o histórico do MULTI_PRECO do produto, na loja da linha da grade, aberto no VRVENDA; item "código de barras-descrição" */}
      {multiPreco && ab && (
        <HistoricoDinamicoModal historico={{ tabela: 'MULTI_PRECO', campoDefault: 'VRVENDA' }} valor={ab.produto.idproduto} empresa={ab.idempresa}
          titulo="Precificação de Mercadorias" item={`${ab.produto.codbarra ?? ''}-${ab.produto.descricao ?? ''}`} onFechar={() => setMultiPreco(false)} />
      )}
    </div>
  );
}
