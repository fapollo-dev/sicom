import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirPagina } from '../../shared/print/imprimirPagina';

/**
 * APURAÇÃO PIS/COFINS (`FRMAPURACAOPISCOFINS`).
 *
 * As apurações realizadas, o crédito e o débito lado a lado, e o **saldo por tributo** — que é o valor a
 * recolher do M200/M600. Quando o crédito supera o débito, o que sobra transporta, e a tela diz isso em vez
 * de mostrar um valor a recolher negativo.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = '/fiscal/sped/apuracao-pc';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

interface Apuracao {
  codapuracao_pc: number; dataini: string; datafim: string; operador: string;
  linhas: number; credito: number; debito: number; dtcadastro: string;
}
interface Item {
  codapuracao_pc_det: number; tipo: string; apuracao: string | null; tipo_origem: string | null; descricao: string; cst_pis: number | null;
  id_tipocredito: number | null; descricao_tipocredito: string | null; id_basecredito: number | null; descricaobase: string | null;
  basecalculo: number; aliqpis: number; valorpis: number; aliqcofins: number; valorcofins: number;
  basecalculoapura: number | null; valorpisapura: number | null; valorcofinsapura: number | null;
}
interface Pai { tipo: string; id_tipocredito: number | null; aliqpis: number; aliqcofins: number; base: number; pis: number; cofins: number; linhas: number }
interface Apoio {
  tipos: Array<{ id_tipocredito: number; descricao: string }>;
  bases: Array<{ idbasecredito: number; descricao: string }>;
  piscofins: Array<{ idpiscofins: number; descricao: string; aliq_pis_ent: number | null; aliq_cofins_ent: number | null }>;
}
interface Config { cfop: string; id_basecredito: number; descricao: string | null }
const vazioAjuste = { id_tipocredito: '', id_basecredito: '', idpiscofins: '', basecalculo: '' };
interface Detalhe {
  codapuracao_pc: number; dataini: string; datafim: string; itens: Item[]; pais: Pai[];
  totais: {
    baseCredito: number; baseDebito: number; creditoPis: number; creditoCofins: number;
    debitoPis: number; debitoCofins: number; aRecolherPis: number; aRecolherCofins: number;
    creditoTransportarPis: number; creditoTransportarCofins: number;
  };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: res.statusText };
    throw Object.assign(new Error(env.code), { envelope: env });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export function ApuracaoPisCofinsPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<Apuracao[]>([]);
  const [aberta, setAberta] = useState<Detalhe | null>(null);
  const [periodo, setPeriodo] = useState({ dtini: diaUm(), dtfim: hoje() });
  const [ocupado, setOcupado] = useState(false);
  const [apoio, setApoio] = useState<Apoio | null>(null);
  const [config, setConfig] = useState<Config[]>([]);
  const [novaConfig, setNovaConfig] = useState({ cfop: '', id_basecredito: '' });
  const [ajuste, setAjuste] = useState(vazioAjuste);
  const [rel, setRel] = useState<Record<string, any> | null>(null);
  const relRef = useRef<HTMLDivElement>(null);
  const janelaRel = useRef<Window | null>(null);
  // os créditos do período anterior do Resumo — campo da tela, não gravado (`EdtCreditosPISAnterior`/`EdtCreditoCofinsAnt`)
  const [anterior, setAnterior] = useState({ pis: '', cofins: '' });

  const carregar = useCallback(async () => {
    try { setLista(await req<Apuracao[]>(P)); } catch (e) { mensagem.erro(e); }
  }, [mensagem]);
  const carregarConfig = useCallback(async () => {
    try { setConfig(await req<Config[]>(`${P}-config`)); } catch (e) { mensagem.erro(e); }
  }, [mensagem]);

  useEffect(() => { void carregar(); void carregarConfig(); }, [carregar, carregarConfig]);
  useEffect(() => { req<Apoio>(`${P}-apoio`).then(setApoio).catch(() => undefined); }, []);

  const apurar = async () => {
    setOcupado(true);
    try {
      const r = await req<{ codapuracao_pc: number; existente?: boolean }>('/fiscal/sped/apuracao-pc', { method: 'POST', body: JSON.stringify(periodo) });
      // o mesmo período não é refeito (o legado pergunta "já realizada, deseja carregar?"): abre a existente; para refazer, exclua antes
      mensagem.sucesso(r.existente ? 'Apuração já realizada para este período: carregada. Para refazer, exclua-a antes.' : 'Período apurado.');
      await carregar();
      await abrir(r.codapuracao_pc);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const abrir = async (cod: number) => {
    try { setAberta(await req<Detalhe>(`${P}/${cod}`)); } catch (e) { mensagem.erro(e); }
  };

  const excluir = async (cod: number) => {
    setOcupado(true);
    try {
      await req(`${P}/${cod}`, { method: 'DELETE' });
      mensagem.sucesso('Apuração excluída — apure de novo para refazer.');
      if (aberta?.codapuracao_pc === cod) setAberta(null);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const ajustar = async () => {
    if (!aberta) return;
    setOcupado(true);
    try {
      await req(`${P}/${aberta.codapuracao_pc}/ajustes`, { method: 'POST', body: JSON.stringify({
        id_tipocredito: Number(ajuste.id_tipocredito), id_basecredito: Number(ajuste.id_basecredito), idpiscofins: Number(ajuste.idpiscofins),
        basecalculo: Number(String(ajuste.basecalculo).replace(',', '.')) }) });
      mensagem.sucesso('Crédito ajustado.');
      setAjuste(vazioAjuste);
      await abrir(aberta.codapuracao_pc);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const excluirPai = async (p: Pai) => {
    if (!aberta || !window.confirm('Deseja excluir o registro da apuração?')) return;
    setOcupado(true);
    try {
      await req(`${P}/${aberta.codapuracao_pc}/creditos?${new URLSearchParams({ tipo: p.id_tipocredito == null ? '' : String(p.id_tipocredito), aliqpis: String(p.aliqpis) })}`, { method: 'DELETE' });
      await abrir(aberta.codapuracao_pc);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const incluirConfig = async () => {
    try {
      await req(`${P}-config`, { method: 'POST', body: JSON.stringify({ cfop: novaConfig.cfop, id_basecredito: Number(novaConfig.id_basecredito) }) });
      setNovaConfig({ cfop: '', id_basecredito: '' });
      await carregarConfig();
    } catch (e) { mensagem.erro(e); }
  };
  const excluirConfig = async (cfop: string) => {
    try { await req(`${P}-config/${encodeURIComponent(cfop)}`, { method: 'DELETE' }); await carregarConfig(); } catch (e) { mensagem.erro(e); }
  };

  // a impressão (ApuracaoPis_Cofins.fr3): a janela abre no clique (o bloqueador de popup), os totais chegam e a tela imprime o relatório
  const imprimir = async () => {
    if (!aberta) return;
    janelaRel.current = window.open('', '_blank');
    try { setRel(await req<Record<string, any>>(`${P}/${aberta.codapuracao_pc}/relatorio`)); } catch (e) { janelaRel.current?.close(); mensagem.erro(e); }
  };
  useEffect(() => {
    if (!rel || !relRef.current || !janelaRel.current) return;
    imprimirPagina(janelaRel.current, relRef.current, 'Apuração PIS / COFINS');
    janelaRel.current = null;
  }, [rel]);

  const t = aberta?.totais;
  const pcAjuste = apoio?.piscofins.find((x) => String(x.idpiscofins) === ajuste.idpiscofins);
  const baseAjuste = Number(String(ajuste.basecalculo).replace(',', '.')) || 0;
  // o Resumo do legado (`CalculaRecolher`): a recolher = débito − (crédito anterior + crédito); o que fica negativo transporta
  const antPis = Number(String(anterior.pis).replace(',', '.')) || 0;
  const antCof = Number(String(anterior.cofins).replace(',', '.')) || 0;
  const saldoPis = t ? t.debitoPis - (antPis + t.creditoPis) : 0;
  const saldoCof = t ? t.debitoCofins - (antCof + t.creditoCofins) : 0;

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Apuração PIS/COFINS" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Apura o período (as empresas da raiz do CNPJ) e popula o bloco M do EFD-Contribuições. O mesmo período
          <strong> não é refeito</strong>: a apuração existente é carregada — para refazer, exclua-a antes.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={periodo.dtini} onChange={(e) => setPeriodo({ ...periodo, dtini: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={periodo.dtfim} onChange={(e) => setPeriodo({ ...periodo, dtfim: e.target.value })} /></div>
          <Button label="&Apurar" disabled={ocupado} onClick={() => void apurar()} />
        </div>
      </section>

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th className="p-pad-xs">Código</th><th className="p-pad-xs">Período</th>
              <th className="p-pad-xs">Linhas</th><th className="p-pad-xs">Crédito</th>
              <th className="p-pad-xs">Débito</th><th className="p-pad-xs">Operador</th><th />
            </tr>
          </thead>
          <tbody>
            {lista.map((a) => (
              <tr key={a.codapuracao_pc} className="border-b border-border">
                <td className="p-pad-xs">{a.codapuracao_pc}</td>
                <td className="p-pad-xs">{dataBr(a.dataini)} — {dataBr(a.datafim)}</td>
                <td className="p-pad-xs tabular-nums">{a.linhas}</td>
                <td className="p-pad-xs tabular-nums">{moeda(a.credito)}</td>
                <td className="p-pad-xs tabular-nums">{moeda(a.debito)}</td>
                <td className="p-pad-xs">{a.operador}</td>
                <td className="p-pad-xs">
                  <span className="flex gap-gp-xs">
                    <Button variant="outline" label="Abrir" onClick={() => void abrir(a.codapuracao_pc)} />
                    <Button variant="outline" label="Excluir" disabled={ocupado} onClick={() => void excluir(a.codapuracao_pc)} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {aberta && t && (
        <>
          <section className="flex flex-wrap gap-gp-lg rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="w-full"><Button label="&Imprimir" variant="soft" onClick={() => void imprimir()} /></div>
            <div>
              <div className="text-body-sm text-fg-muted">Crédito (PIS / COFINS)</div>
              <div className="text-title-sm tabular-nums">{moeda(t.creditoPis)} / {moeda(t.creditoCofins)}</div>
            </div>
            <div>
              <div className="text-body-sm text-fg-muted">Débito (PIS / COFINS)</div>
              <div className="text-title-sm tabular-nums">{moeda(t.debitoPis)} / {moeda(t.debitoCofins)}</div>
            </div>
            <div className="flex items-end gap-gp-xs">
              <div className="w-32"><Field label="Crédito anterior PIS" inputMode="decimal" value={anterior.pis} onChange={(e) => setAnterior({ ...anterior, pis: e.target.value })} /></div>
              <div className="w-32"><Field label="Crédito anterior COFINS" inputMode="decimal" value={anterior.cofins} onChange={(e) => setAnterior({ ...anterior, cofins: e.target.value })} /></div>
            </div>
            <div className="rounded-radius-sm border border-border bg-bg-subtle px-pad-sm py-pad-xs">
              <div className="text-body-sm text-fg-muted">A recolher (M200 / M600)</div>
              <div className="text-title-sm tabular-nums">{moeda(Math.max(saldoPis, 0))} / {moeda(Math.max(saldoCof, 0))}</div>
            </div>
            {(saldoPis < 0 || saldoCof < 0) && (
              <div>
                <div className="text-body-sm text-fg-muted">Crédito a transportar</div>
                <div className="text-title-sm tabular-nums">{moeda(Math.max(-saldoPis, 0))} / {moeda(Math.max(-saldoCof, 0))}</div>
              </div>
            )}
          </section>

          {(['C', 'D'] as const).map((tipo) => (
            <div key={tipo} className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
              <table className="w-full min-w-[1080px] border-collapse text-body-sm">
                <thead>
                  <tr className="border-b border-border text-left text-fg-muted">
                    <th className="p-pad-xs">{tipo === 'C' ? 'Créditos' : 'Débitos'}</th><th className="p-pad-xs">Base de crédito</th><th className="p-pad-xs">Situação PIS/COFINS</th>
                    <th className="p-pad-xs text-right">Base de cálculo</th><th className="p-pad-xs text-right">Alíq. PIS</th><th className="p-pad-xs text-right">PIS</th>
                    <th className="p-pad-xs text-right">Alíq. COFINS</th><th className="p-pad-xs text-right">COFINS</th>
                    <th className="p-pad-xs text-right">Base (apura)</th><th className="p-pad-xs text-right">PIS (apura)</th><th className="p-pad-xs text-right">COFINS (apura)</th>
                  </tr>
                </thead>
                <tbody>
                  {aberta.pais.filter((p) => p.tipo === tipo).map((p) => (
                    <FragmentoPai key={`${p.tipo}-${p.id_tipocredito}-${p.aliqpis}`} pai={p} itens={aberta.itens.filter((i) => i.tipo === tipo && i.id_tipocredito === p.id_tipocredito && Number(i.aliqpis) === Number(p.aliqpis))}
                      onExcluir={tipo === 'C' && !ocupado ? () => void excluirPai(p) : undefined} />
                  ))}
                </tbody>
              </table>
              {tipo === 'C' && apoio && (
                // o "Ajusta Apuração" do legado (UAjustaApuracaoPC): uma linha de crédito digitada, com as alíquotas de ENTRADA da situação
                <div className="flex flex-wrap items-end gap-gp-sm border-t border-border p-pad-sm">
                  <label className="flex flex-col text-body-sm">Tipo de crédito
                    <select className="rounded-radius-sm border border-border bg-bg-surface px-pad-xs py-pad-xs" value={ajuste.id_tipocredito} onChange={(e) => setAjuste({ ...ajuste, id_tipocredito: e.target.value })}>
                      <option value="">—</option>{apoio.tipos.map((x) => <option key={x.id_tipocredito} value={x.id_tipocredito}>{x.id_tipocredito} {x.descricao}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col text-body-sm">Base de crédito
                    <select className="rounded-radius-sm border border-border bg-bg-surface px-pad-xs py-pad-xs" value={ajuste.id_basecredito} onChange={(e) => setAjuste({ ...ajuste, id_basecredito: e.target.value })}>
                      <option value="">—</option>{apoio.bases.map((x) => <option key={x.idbasecredito} value={x.idbasecredito}>{x.idbasecredito} {x.descricao}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col text-body-sm">PIS/COFINS
                    <select className="rounded-radius-sm border border-border bg-bg-surface px-pad-xs py-pad-xs" value={ajuste.idpiscofins} onChange={(e) => setAjuste({ ...ajuste, idpiscofins: e.target.value })}>
                      <option value="">—</option>{apoio.piscofins.map((x) => <option key={x.idpiscofins} value={x.idpiscofins}>{x.idpiscofins} {x.descricao}</option>)}
                    </select>
                  </label>
                  <div className="w-36"><Field label="Base de cálculo" inputMode="decimal" value={ajuste.basecalculo} onChange={(e) => setAjuste({ ...ajuste, basecalculo: e.target.value })} /></div>
                  {pcAjuste && (
                    <span className="text-body-sm tabular-nums text-fg-muted">
                      PIS {Number(pcAjuste.aliq_pis_ent ?? 0)}% = {moeda((baseAjuste * Number(pcAjuste.aliq_pis_ent ?? 0)) / 100)} · COFINS {Number(pcAjuste.aliq_cofins_ent ?? 0)}% = {moeda((baseAjuste * Number(pcAjuste.aliq_cofins_ent ?? 0)) / 100)}
                    </span>
                  )}
                  <Button label="A&justar crédito" disabled={ocupado || !ajuste.id_tipocredito || !ajuste.id_basecredito || !ajuste.idpiscofins} onClick={() => void ajustar()} />
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {rel && <div ref={relRef} className="hidden"><RelatorioApuracao r={rel} /></div>}

      {/* a aba Configuração do legado: os CFOPs que entram na base do crédito (PC_CONFIG) */}
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <h2 className="mb-form-gap text-title-sm">Configuração — CFOPs da base do crédito</h2>
        <div className="mb-form-gap flex flex-wrap items-end gap-gp-sm">
          <div className="w-24"><Field label="CFOP" inputMode="numeric" maxLength={4} value={novaConfig.cfop} onChange={(e) => setNovaConfig({ ...novaConfig, cfop: e.target.value.replace(/\D/g, '') })} /></div>
          <label className="flex flex-col text-body-sm">Base de crédito
            <select className="rounded-radius-sm border border-border bg-bg-surface px-pad-xs py-pad-xs" value={novaConfig.id_basecredito} onChange={(e) => setNovaConfig({ ...novaConfig, id_basecredito: e.target.value })}>
              <option value="">—</option>{(apoio?.bases ?? []).map((x) => <option key={x.idbasecredito} value={x.idbasecredito}>{x.idbasecredito} {x.descricao}</option>)}
            </select>
          </label>
          <Button label="Incluir" variant="soft" disabled={!novaConfig.cfop || !novaConfig.id_basecredito} onClick={() => void incluirConfig()} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-body-sm">
            <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">CFOP</th><th className="p-pad-xs">Base de crédito</th><th /></tr></thead>
            <tbody>{config.map((c) => (
              <tr key={c.cfop} className="border-b border-border">
                <td className="p-pad-xs tabular-nums">{c.cfop}</td><td className="p-pad-xs">{c.id_basecredito} {c.descricao ?? ''}</td>
                <td className="p-pad-xs"><Button variant="outline" label="Excluir" onClick={() => void excluirConfig(c.cfop)} /></td>
              </tr>))}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** o pai (tipo de crédito × alíquota, PIS/COFINS recalculados — como a tela do legado) e os filhos (as linhas gravadas) */
function FragmentoPai({ pai, itens, onExcluir }: { pai: Pai; itens: Item[]; onExcluir?: () => void }) {
  const pct = (v: unknown) => `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
  return (
    <>
      <tr className="border-b border-border bg-bg-subtle font-semibold">
        <td className="p-pad-xs" colSpan={3}>{pai.id_tipocredito ?? ''} {itens[0]?.descricao_tipocredito ?? ''}</td>
        <td className="p-pad-xs text-right tabular-nums">{moeda(pai.base)}</td><td className="p-pad-xs text-right tabular-nums">{pct(pai.aliqpis)}</td>
        <td className="p-pad-xs text-right tabular-nums">{moeda(pai.pis)}</td><td className="p-pad-xs text-right tabular-nums">{pct(pai.aliqcofins)}</td>
        <td className="p-pad-xs text-right tabular-nums">{moeda(pai.cofins)}</td>
        <td colSpan={3} className="p-pad-xs text-right">{onExcluir && <Button variant="outline" label="Excluir" onClick={onExcluir} />}</td>
      </tr>
      {itens.map((i) => (
        <tr key={i.codapuracao_pc_det} className="border-b border-border">
          <td className="p-pad-xs text-fg-muted">{i.tipo_origem ?? ''}</td>
          <td className="p-pad-xs">{i.id_basecredito ?? ''} {i.descricaobase ?? ''}</td>
          <td className="p-pad-xs">{i.descricao}</td>
          <td className="p-pad-xs text-right tabular-nums">{moeda(i.basecalculo)}</td><td className="p-pad-xs text-right tabular-nums">{pct(i.aliqpis)}</td>
          <td className="p-pad-xs text-right tabular-nums">{moeda(i.valorpis)}</td><td className="p-pad-xs text-right tabular-nums">{pct(i.aliqcofins)}</td>
          <td className="p-pad-xs text-right tabular-nums">{moeda(i.valorcofins)}</td>
          <td className="p-pad-xs text-right tabular-nums">{i.basecalculoapura != null ? moeda(i.basecalculoapura) : ''}</td>
          <td className="p-pad-xs text-right tabular-nums">{i.valorpisapura != null ? moeda(i.valorpisapura) : ''}</td>
          <td className="p-pad-xs text-right tabular-nums">{i.valorcofinsapura != null ? moeda(i.valorcofinsapura) : ''}</td>
        </tr>
      ))}
    </>
  );
}

/** o relatório `ApuracaoPis_Cofins.fr3`: o cabeçalho da empresa, as receitas, os créditos e a apuração COFINS × PIS */
function RelatorioApuracao({ r }: { r: Record<string, any> }) {
  const v = (x: unknown) => Number(x ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const linha = (rot: string, x: unknown) => <tr key={rot}><td>{rot}</td><td className="text-right tabular-nums">{v(x)}</td></tr>;
  const e = r.empresa ?? {};
  return (
    <div>
      <p><strong>{e.razao_social ?? ''}</strong> — {e.fantasia ?? ''} · CNPJ: {e.cnpj ?? ''} · INSC: {e.insc ?? ''} · Fone: {e.fone1 ?? ''}</p>
      <p>Competencia: {dataBr(r.dataini)} até {dataBr(r.datafim)}</p>
      <table><tbody>
        {linha('Total de Receitas com Revendas ECFs', r.TOTRECECF)}
        {linha('Total de Receitas com Revendas Notas Fiscais', r.TOTRECNF)}
        {linha('Total de Receitas com Prestação de Serviços', r.TOTRECSERV)}
        {linha('Outras Receitas', r.TOTRECOUT)}
        {linha('(-) Outras Deduções', 0)}
        {linha('(-) Receita Tributada Aliquota ZERO', r.TOTRECZERO)}
        {linha('BASE DE CALCULO NA APURAÇÃO DO IMPOSTO', r.BASEAPURACAO)}
      </tbody></table>
      <table><tbody>
        {linha('Total de Bens Adquiridos para Revenda', r.TOTBENSREV)}
        {linha('Base de Calculo para Credito de Bens Adquiridos - Aliquota 9,25%', r.TOTBENADQALQ)}
        {linha('Base de Calculo para Credito de Bens Adquiridos - Aliquota Diferenciada', r.TOTBENADQDIF)}
        {linha('Bens Adquiridos para Revenda - Monofásicos', r.TOTBENADQMON)}
        {linha('Crédito Fretes s/compras', r.TOTCREDFRETE)}
        {linha('Crédito Energia Elétrica', r.TOTCREDELE)}
        {linha('Devolução de Vendas', r.TOTDEVVENDAS)}
        {linha('BASE DE CALCULO NA APURAÇÃO DOS CRÉDITOS', r.TOTBASECRED)}
      </tbody></table>
      <table>
        <thead><tr><th>Apuração</th><th className="text-right">COFINS</th><th className="text-right">PIS</th></tr></thead>
        <tbody>
          {([
            // as linhas sem variável no .fr3 (saldo credor, dedução processual, total) saem em branco, como no relatório do legado
            ['Saldo Credor Mês Anterior', null, null], ['Valor Débito Saídas', r.TOTDEBSAICOF, r.TOTDEBSAIPIS],
            ['(-) Ajuste Negativo Devolução de Vendas', r.TOTAJUSNEGDEVCOF, r.TOTAJUSNEGDEVPIS], ['Outros Débitos', r.TOTOUTDEBCOF, r.TOTOUTDEBPIS],
            ['Valor Crédito Entradas', r.TOTVALCREENTCOF, r.TOTVALCREENTPIS], ['Outros Créditos', r.TOTOUTCRECOF, r.TOTOUTCREPIS],
            ['(-) Ajuste Negativo Devolução de Compras', r.TOTAJUNEGCOF, r.TOTAJUNEGPIS],
            ['Valor á Recolher Antes de Deduções Processuais', r.TOTVALRECCOF, r.TOTVALRECPIS],
            ['Dedução do Crédito ICMS Conforme Processo', null, null], ['Valor Total a Recolher', null, null],
          ] as Array<[string, unknown, unknown]>).map(([rot, c, p]) => (
            <tr key={rot}><td>{rot}</td><td className="text-right tabular-nums">{c == null ? '' : v(c)}</td><td className="text-right tabular-nums">{p == null ? '' : v(p)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
