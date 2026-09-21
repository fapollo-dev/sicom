import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * REFORMA TRIBUTÁRIA IBS/CBS — cadastros (`FRMCADCSTIBSCBS` e `FRMCADCLASSTRIBIBSCBS`).
 * Dossiê: `uCadIBSCBS.md`. Migrations 278 (cadastros) e 279 (grupos na nota).
 *
 * Quatro abas porque são quatro coisas diferentes: o catálogo de CST (com as 9 flags por documento
 * fiscal), a classificação tributária da LC 214/2025 (onde as reduções de IBS e CBS são independentes),
 * a alíquota por UF ao lado do parâmetro com vigência, e os grupos calculados de uma nota — onde o valor
 * sai da alíquota EFETIVA e as colunas do fornecedor ficam ao lado para conferência.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Cst = {
  cst: string; descricao_cst: string; ind_gibscbs: number; ind_gibscbsmono: number; ind_gred: number;
  ind_gdif: number; ind_gtranf_cred: number; ind_nfe: string; ind_nfce: string; ind_cte: string;
  ind_cteos: string; ind_bpe: string; ind_bpetm: string; ind_nf3e: string; ind_nfcom: string;
  ind_nfse: string; classificacoes: number;
};
type ClassTrib = {
  codclass_trib: number; cst: string; descricao_cst: string; class_trib: string; nome_class_trib: string;
  descricao_class_trib: string | null; lc_redacao: string | null; lc_214_25: string | null;
  tipo_aliquota: string | null; pred_ibs: number | null; pred_cbs: number | null;
  produtos: number; ncms: number; indr: string | null;
};
type Ncm = {
  codcclass_trib_ncm: number; cclass_trib: string; cst: string; anexo: string | null;
  legislacao: string | null; codigo_ncm: string; nome_class_trib: string | null;
  pred_ibs: number | null; pred_cbs: number | null;
};
type GrupoItem = {
  codnfprod: number; nroitem: number | null; descricao: string | null; codproduto: number;
  cst: string | null; cclasstrib: string | null; nome_class_trib: string | null; vbc: number;
  pibsuf: number | null; predaliq_ibsuf: number | null; paliqefet_ibsuf: number | null; vibsuf: number;
  pcbs: number | null; predaliq_cbs: number | null; paliqefet_cbs: number | null; vcbs: number;
  cst_ori: string | null; cclasstrib_ori: string | null; vbc_ori: number | null; divergencias: string[];
};
type Grupos = {
  cabecalho: { codnf: number; vbcibscbs: number; vibsuf: number; vibsmun: number; vibs: number;
    vcbs: number; ibs_fecha: boolean } | null;
  itens: GrupoItem[];
};
type Uf = {
  codibs_uf: number; uf: string; valor_ibs_uf: number; ibs_parametro: number | null;
  cbs_parametro: number | null; vigencia_inicio: string | null; fonte: string | null; diverge: boolean;
};

const DOCS = [
  ['ind_nfe', 'NF-e'], ['ind_nfce', 'NFC-e'], ['ind_cte', 'CT-e'], ['ind_cteos', 'CT-e OS'],
  ['ind_bpe', 'BP-e'], ['ind_bpetm', 'BP-e TM'], ['ind_nf3e', 'NF3e'], ['ind_nfcom', 'NFCom'],
  ['ind_nfse', 'NFS-e'],
] as const;

const pct = (v: number | null) => (v == null ? '' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}%`);
const vazio = () => ({
  cst: '', descricao_cst: '', class_trib: '', nome_class_trib: '', descricao_class_trib: '',
  lc_redacao: '', lc_214_25: '', tipo_aliquota: '', pred_ibs: '', pred_cbs: '',
});

export function ReformaIbsCbsPage() {
  const mensagem = useMensagem();
  const [aba, setAba] = useState<'class' | 'cst' | 'uf' | 'nota'>('class');
  const [q, setQ] = useState('');
  const [soNfe, setSoNfe] = useState(false);
  const [csts, setCsts] = useState<Cst[]>([]);
  const [classes, setClasses] = useState<ClassTrib[]>([]);
  const [ncms, setNcms] = useState<Ncm[]>([]);
  const [ufs, setUfs] = useState<Uf[]>([]);
  const [ncmQ, setNcmQ] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [f, setF] = useState<Record<string, string>>(vazio());
  const [ocupado, setOcupado] = useState(false);
  const [codnf, setCodnf] = useState('');
  const [soDiv, setSoDiv] = useState(false);
  const [grupos, setGrupos] = useState<Grupos | null>(null);

  const pedir = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(url, { ...init, headers: { ...apiHeaders(), ...(init?.headers ?? {}) } });
    handle401(r);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
      throw Object.assign(new Error(env.code), { envelope: env });
    }
    return (await r.json()) as T;
  };

  const carregarCst = async () => {
    try {
      const p = new URLSearchParams({ q: q.trim(), limite: '300' });
      if (soNfe) p.set('so_nfe', 'true');
      setCsts(await pedir<Cst[]>(`${BASE}/cadastro/reforma-ibscbs/cst?${p}`));
    } catch (e) { mensagem.erro(e); }
  };
  const carregarClasses = async () => {
    try {
      setClasses(await pedir<ClassTrib[]>(`${BASE}/cadastro/reforma-ibscbs/class-trib?${new URLSearchParams({ q: q.trim(), limite: '300' })}`));
    } catch (e) { mensagem.erro(e); }
  };
  const carregarNcm = async () => {
    try {
      const p = new URLSearchParams({ limite: '300' });
      if (ncmQ.trim()) p.set('ncm', ncmQ.trim());
      setNcms(await pedir<Ncm[]>(`${BASE}/cadastro/reforma-ibscbs/ncm?${p}`));
    } catch (e) { mensagem.erro(e); }
  };
  const carregarUf = async () => {
    try { setUfs(await pedir<Uf[]>(`${BASE}/cadastro/reforma-ibscbs/ibs-uf`)); } catch (e) { mensagem.erro(e); }
  };
  const carregarGrupos = async () => {
    if (!codnf.trim()) return;
    try {
      const p = new URLSearchParams({ codnf: codnf.trim() });
      if (soDiv) p.set('so_divergentes', 'true');
      setGrupos(await pedir<Grupos>(`${BASE}/fiscal/nf-ibscbs?${p}`));
    } catch (e) { mensagem.erro(e); }
  };
  const calcular = async () => {
    if (!codnf.trim()) return;
    setOcupado(true);
    try {
      await pedir(`${BASE}/fiscal/nf-ibscbs/calcular`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codnf: Number(codnf) }),
      });
      mensagem.sucesso('Grupos IBS/CBS recalculados.'); await carregarGrupos();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  useEffect(() => {
    if (aba === 'cst') void carregarCst();
    if (aba === 'class') void carregarClasses();
    if (aba === 'uf') void carregarUf();
  }, [aba]);

  const editar = (c: ClassTrib) => {
    setSel(c.codclass_trib);
    setF({
      cst: c.cst, descricao_cst: c.descricao_cst, class_trib: c.class_trib,
      nome_class_trib: c.nome_class_trib, descricao_class_trib: c.descricao_class_trib ?? '',
      lc_redacao: c.lc_redacao ?? '', lc_214_25: c.lc_214_25 ?? '', tipo_aliquota: c.tipo_aliquota ?? '',
      pred_ibs: c.pred_ibs == null ? '' : String(c.pred_ibs),
      pred_cbs: c.pred_cbs == null ? '' : String(c.pred_cbs),
    });
  };
  const novo = () => { setSel(null); setF(vazio()); };

  const gravar = async () => {
    setOcupado(true);
    try {
      const corpo = {
        cst: f.cst.trim(), descricao_cst: f.descricao_cst.trim(), class_trib: f.class_trib.trim(),
        nome_class_trib: f.nome_class_trib.trim(),
        descricao_class_trib: f.descricao_class_trib.trim() || null,
        lc_redacao: f.lc_redacao.trim() || null, lc_214_25: f.lc_214_25.trim() || null,
        tipo_aliquota: f.tipo_aliquota.trim() || null,
        pred_ibs: f.pred_ibs.trim() === '' ? null : Number(f.pred_ibs.replace(',', '.')),
        pred_cbs: f.pred_cbs.trim() === '' ? null : Number(f.pred_cbs.replace(',', '.')),
      };
      await pedir(`${BASE}/cadastro/reforma-ibscbs/class-trib`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
      });
      mensagem.sucesso('Classificação gravada.'); novo(); await carregarClasses();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const excluir = async () => {
    if (!sel || !window.confirm('Excluir esta classificação tributária?')) return;
    try {
      await pedir(`${BASE}/cadastro/reforma-ibscbs/class-trib/${sel}`, { method: 'DELETE' });
      mensagem.sucesso('Classificação excluída.'); novo(); await carregarClasses();
    } catch (e) { mensagem.erro(e); }
  };

  const assimetrica = (c: ClassTrib) => c.pred_ibs != null && c.pred_cbs != null && c.pred_ibs !== c.pred_cbs;

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Reforma tributária — IBS/CBS" />

      <div className="flex gap-gp-sm">
        <Button label="&Classificação tributária" variant={aba === 'class' ? 'filled' : 'outline'} onClick={() => setAba('class')} />
        <Button label="C&ST" variant={aba === 'cst' ? 'filled' : 'outline'} onClick={() => setAba('cst')} />
        <Button label="Alíquota por &UF" variant={aba === 'uf' ? 'filled' : 'outline'} onClick={() => setAba('uf')} />
        <Button label="Grupos na &nota" variant={aba === 'nota' ? 'filled' : 'outline'} onClick={() => setAba('nota')} />
      </div>

      {aba === 'class' && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <p className="mb-form-gap text-body-sm text-fg-muted">
              O cClassTrib de 6 dígitos que vai no XML, com a redação da LC 214/2025 ao lado. A redução de
              IBS e a de CBS são <strong>independentes</strong> — há classificação com 60% no IBS e 100% na
              CBS, e aplicar um percentual só aos dois cobra imposto a mais.
            </p>
            <div className="flex flex-wrap items-end gap-gp-sm">
              <div className="w-24"><Field label="C&ST" value={f.cst} maxLength={3} onChange={(e) => setF({ ...f, cst: e.target.value.replace(/\D/g, '') })} /></div>
              <div className="w-64"><Field label="Descrição da CST" value={f.descricao_cst} onChange={(e) => setF({ ...f, descricao_cst: e.target.value })} /></div>
              <div className="w-32"><Field label="cClass&Trib" value={f.class_trib} maxLength={6} onChange={(e) => setF({ ...f, class_trib: e.target.value.replace(/\D/g, '') })} /></div>
              <div className="w-[26rem]"><Field label="&Nome" value={f.nome_class_trib} onChange={(e) => setF({ ...f, nome_class_trib: e.target.value })} /></div>
              <div className="w-48"><Field label="Artigo da LC 214/25" value={f.lc_214_25} onChange={(e) => setF({ ...f, lc_214_25: e.target.value })} /></div>
              <div className="w-40"><Field label="Tipo de alíquota" value={f.tipo_aliquota} onChange={(e) => setF({ ...f, tipo_aliquota: e.target.value })} /></div>
              <div className="w-28"><Field label="Redução &IBS %" value={f.pred_ibs} onChange={(e) => setF({ ...f, pred_ibs: e.target.value })} /></div>
              <div className="w-28"><Field label="Redução C&BS %" value={f.pred_cbs} onChange={(e) => setF({ ...f, pred_cbs: e.target.value })} /></div>
              <Button label={sel ? '&Gravar' : '&Incluir'} disabled={ocupado} onClick={() => void gravar()} />
              <Button label="No&vo" variant="outline" onClick={novo} />
              {sel && <Button label="E&xcluir" variant="ghost" onClick={() => void excluir()} />}
            </div>
            <div className="mt-form-gap"><Field label="Redação do artigo" value={f.lc_redacao} onChange={(e) => setF({ ...f, lc_redacao: e.target.value })} /></div>
          </section>

          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-end gap-gp-sm">
              <div className="w-80"><Field label="&Buscar (código, nome ou artigo)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void carregarClasses(); }} /></div>
              <Button label="&Pesquisar" onClick={() => void carregarClasses()} />
              <span className="text-body-sm text-fg-muted">{classes.length} classificação(ões)</span>
            </div>
            <div className="mt-form-gap overflow-x-auto">
              <table className="w-full min-w-[1000px] border-collapse text-body-sm">
                <thead><tr className="border-b border-border text-left text-fg-muted">
                  <th className="p-pad-xs">cClassTrib</th><th className="p-pad-xs">CST</th><th className="p-pad-xs">Nome</th>
                  <th className="p-pad-xs">Artigo</th><th className="p-pad-xs text-right">Red. IBS</th>
                  <th className="p-pad-xs text-right">Red. CBS</th><th className="p-pad-xs text-right">NCMs</th>
                  <th className="p-pad-xs text-right">Produtos</th>
                </tr></thead>
                <tbody>{classes.map((c) => (
                  <tr key={c.codclass_trib} className={`cursor-pointer border-b border-border hover:bg-bg-muted ${sel === c.codclass_trib ? 'bg-bg-muted' : ''}`} onClick={() => editar(c)}>
                    <td className="p-pad-xs tabular-nums">{c.class_trib}</td>
                    <td className="p-pad-xs tabular-nums">{c.cst}</td>
                    <td className="p-pad-xs">{c.nome_class_trib}</td>
                    <td className="p-pad-xs text-fg-muted">{c.lc_214_25 ?? ''}</td>
                    <td className="p-pad-xs text-right tabular-nums">{pct(c.pred_ibs)}</td>
                    <td className={`p-pad-xs text-right tabular-nums ${assimetrica(c) ? 'font-semibold text-fg-danger' : ''}`}
                        title={assimetrica(c) ? 'redução diferente da do IBS — as duas são independentes' : undefined}>
                      {pct(c.pred_cbs)}
                    </td>
                    <td className="p-pad-xs text-right tabular-nums">{c.ncms}</td>
                    <td className="p-pad-xs text-right tabular-nums">{c.produtos}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </section>

          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-end gap-gp-sm">
              <h4 className="text-body-sm font-semibold">Anexos da LC por NCM</h4>
              <div className="w-48"><Field label="&NCM (prefixo)" value={ncmQ} maxLength={8} onChange={(e) => setNcmQ(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void carregarNcm(); }} /></div>
              <Button label="Con&sultar" variant="outline" onClick={() => void carregarNcm()} />
              <span className="text-body-sm text-fg-muted">o anexo lista o NCM com 8 dígitos; informe o capítulo ou a posição</span>
            </div>
            {ncms.length > 0 && (
              <div className="mt-form-gap overflow-x-auto">
                <table className="w-full min-w-[800px] border-collapse text-body-sm">
                  <thead><tr className="border-b border-border text-left text-fg-muted">
                    <th className="p-pad-xs">NCM</th><th className="p-pad-xs">cClassTrib</th><th className="p-pad-xs">Nome</th>
                    <th className="p-pad-xs">Anexo</th><th className="p-pad-xs">Legislação</th>
                    <th className="p-pad-xs text-right">Red. IBS</th><th className="p-pad-xs text-right">Red. CBS</th>
                  </tr></thead>
                  <tbody>{ncms.map((n) => (
                    <tr key={n.codcclass_trib_ncm} className="border-b border-border">
                      <td className="p-pad-xs tabular-nums">{n.codigo_ncm}</td>
                      <td className="p-pad-xs tabular-nums">{n.cclass_trib}</td>
                      <td className="p-pad-xs">{n.nome_class_trib ?? ''}</td>
                      <td className="p-pad-xs">{n.anexo ?? ''}</td>
                      <td className="p-pad-xs text-fg-muted">{n.legislacao ?? ''}</td>
                      <td className="p-pad-xs text-right tabular-nums">{pct(n.pred_ibs)}</td>
                      <td className="p-pad-xs text-right tabular-nums">{pct(n.pred_cbs)}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {aba === 'cst' && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <p className="mb-form-gap text-body-sm text-fg-muted">
            O catálogo de CST da reforma. Cada CST vale para <strong>alguns</strong> documentos fiscais e não
            para outros — são nove indicadores separados, não um.
          </p>
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-64"><Field label="&Buscar (CST ou descrição)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void carregarCst(); }} /></div>
            <label className="flex items-center gap-gp-xs text-body-sm">
              <input type="checkbox" checked={soNfe} onChange={(e) => { setSoNfe(e.target.checked); }} /> só as válidas para NF-e
            </label>
            <Button label="&Pesquisar" onClick={() => void carregarCst()} />
            <span className="text-body-sm text-fg-muted">{csts.length} CST(s)</span>
          </div>
          <div className="mt-form-gap overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">CST</th><th className="p-pad-xs">Descrição</th>
                {DOCS.map(([k, r]) => <th key={k} className="p-pad-xs text-center">{r}</th>)}
                <th className="p-pad-xs text-right">Classif.</th>
              </tr></thead>
              <tbody>{csts.map((c) => (
                <tr key={c.cst} className="border-b border-border">
                  <td className="p-pad-xs tabular-nums">{c.cst}</td>
                  <td className="p-pad-xs">{c.descricao_cst}</td>
                  {DOCS.map(([k]) => (
                    <td key={k} className={`p-pad-xs text-center ${c[k] === 'S' ? '' : 'text-fg-muted'}`}>{c[k] === 'S' ? '✓' : '—'}</td>
                  ))}
                  <td className="p-pad-xs text-right tabular-nums">{c.classificacoes}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      )}

      {aba === 'nota' && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <p className="mb-form-gap text-body-sm text-fg-muted">
            Os grupos IBS/CBS de uma nota. O valor sai da alíquota <strong>efetiva</strong> (a cheia menos a
            redução da classificação): usar a cheia cobraria 23× a mais nos itens reduzidos. As colunas
            &quot;fornecedor&quot; mostram o que veio no XML — quando a conferência muda a CST, a
            classificação ou a base, a linha fica marcada.
          </p>
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-40"><Field label="&Nota (codnf)" value={codnf} onChange={(e) => setCodnf(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void carregarGrupos(); }} /></div>
            <Button label="&Consultar" onClick={() => void carregarGrupos()} />
            <Button label="Reca&lcular" variant="outline" disabled={ocupado} onClick={() => void calcular()} />
            <label className="flex items-center gap-gp-xs text-body-sm">
              <input type="checkbox" checked={soDiv} onChange={(e) => setSoDiv(e.target.checked)} /> só o que a conferência mudou
            </label>
          </div>
          {grupos?.cabecalho && (
            <div className="mt-form-gap flex flex-wrap gap-gp-md text-body-sm">
              <span>Base <strong className="tabular-nums">{grupos.cabecalho.vbcibscbs.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
              <span>IBS-UF <strong className="tabular-nums">{grupos.cabecalho.vibsuf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
              <span>IBS-Mun <strong className="tabular-nums">{grupos.cabecalho.vibsmun.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
              <span>IBS <strong className="tabular-nums">{grupos.cabecalho.vibs.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
              <span>CBS <strong className="tabular-nums">{grupos.cabecalho.vcbs.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
              {!grupos.cabecalho.ibs_fecha && <span className="font-semibold text-fg-danger">o IBS total não fecha com UF + município</span>}
            </div>
          )}
          {grupos && grupos.itens.length > 0 && (
            <div className="mt-form-gap overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-body-sm">
                <thead><tr className="border-b border-border text-left text-fg-muted">
                  <th className="p-pad-xs">Item</th><th className="p-pad-xs">Produto</th>
                  <th className="p-pad-xs">CST</th><th className="p-pad-xs">cClassTrib</th>
                  <th className="p-pad-xs text-right">Base</th>
                  <th className="p-pad-xs text-right">IBS efet.</th><th className="p-pad-xs text-right">IBS</th>
                  <th className="p-pad-xs text-right">CBS efet.</th><th className="p-pad-xs text-right">CBS</th>
                  <th className="p-pad-xs">Fornecedor mandou</th>
                </tr></thead>
                <tbody>{grupos.itens.map((g) => (
                  <tr key={g.codnfprod} className={`border-b border-border ${g.divergencias.length ? 'bg-bg-muted' : ''}`}>
                    <td className="p-pad-xs tabular-nums">{g.nroitem ?? ''}</td>
                    <td className="p-pad-xs">{g.descricao ?? g.codproduto}</td>
                    <td className={`p-pad-xs tabular-nums ${g.divergencias.includes('cst') ? 'font-semibold text-fg-danger' : ''}`}>{g.cst ?? '—'}</td>
                    <td className={`p-pad-xs tabular-nums ${g.divergencias.includes('cclasstrib') ? 'font-semibold text-fg-danger' : ''}`} title={g.nome_class_trib ?? undefined}>{g.cclasstrib ?? '—'}</td>
                    <td className={`p-pad-xs text-right tabular-nums ${g.divergencias.includes('vbc') ? 'font-semibold text-fg-danger' : ''}`}>{g.vbc.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td className="p-pad-xs text-right tabular-nums text-fg-muted">{pct(g.paliqefet_ibsuf)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{g.vibsuf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td className="p-pad-xs text-right tabular-nums text-fg-muted">{pct(g.paliqefet_cbs)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{g.vcbs.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td className="p-pad-xs text-fg-muted">
                      {g.divergencias.length === 0 ? '—' : `CST ${g.cst_ori ?? '—'} · ${g.cclasstrib_ori ?? '—'} · base ${(g.vbc_ori ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                    </td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
          {grupos && grupos.itens.length === 0 && (
            <p className="mt-form-gap text-body-sm text-fg-muted">Nenhum item{soDiv ? ' divergente' : ''} nesta nota.</p>
          )}
        </section>
      )}

      {aba === 'uf' && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <p className="mb-form-gap text-body-sm text-fg-muted">
            À esquerda a tabela operacional; à direita o parâmetro com vigência e CBS, que é quem manda no
            cálculo do preço. Quando os dois discordam, a linha fica marcada.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">UF</th><th className="p-pad-xs text-right">IBS (tabela)</th>
                <th className="p-pad-xs text-right">IBS (parâmetro)</th><th className="p-pad-xs text-right">CBS (parâmetro)</th>
                <th className="p-pad-xs">Vigência</th><th className="p-pad-xs">Fonte</th>
              </tr></thead>
              <tbody>{ufs.map((u) => (
                <tr key={u.codibs_uf} className={`border-b border-border ${u.diverge ? 'bg-bg-muted' : ''}`}>
                  <td className="p-pad-xs">{u.uf}</td>
                  <td className="p-pad-xs text-right tabular-nums">{pct(u.valor_ibs_uf)}</td>
                  <td className={`p-pad-xs text-right tabular-nums ${u.diverge ? 'font-semibold text-fg-danger' : ''}`}>
                    {u.ibs_parametro == null ? '—' : pct(u.ibs_parametro)}
                  </td>
                  <td className="p-pad-xs text-right tabular-nums">{u.cbs_parametro == null ? '—' : pct(u.cbs_parametro)}</td>
                  <td className="p-pad-xs text-fg-muted">{u.vigencia_inicio ?? ''}</td>
                  <td className="p-pad-xs text-fg-muted">{u.fonte ?? ''}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
