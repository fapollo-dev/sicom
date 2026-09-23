import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * HISTÓRICO DE PROCESSAMENTO DA NF — por que o custo do produto mudou (mig 291).
 *
 * O kardex responde "quanto entrou". Esta tela responde "por que o custo mudou": em que nota, em que data,
 * de quanto para quanto. Cada evento é um par antes/depois, e a tela mostra os dois lados com a variação —
 * porque mostrar só o resultado apaga a evidência de como se chegou nele.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Degrau = {
  campo: string; antes: number | null; depois: number | null; mudou: boolean;
  variacao: number; variacao_pct: number | null;
};
type Evento = {
  codhistprocnf: number; dthistorico: string; codnf: number | null; nronf: string | null;
  serie: string | null; codproduto: number; produto: string | null; fornecedor: string | null;
  unidade: string | null; usuhistorico: number | null;
  alterou_custo: boolean; alterou_venda: boolean; por_decomposicao: boolean; por_estoque: boolean;
  por_cfop: boolean; venda_online: boolean; venda_lote: boolean; tem_par: boolean; escada: Degrau[];
};
type Resposta = {
  itens: Evento[]; total: number;
  resumo: { eventos: number; alteraram_custo: number; alteraram_venda: number; sem_par: number };
};

/** o nome de cada degrau em português, na ordem em que o legado os calcula */
const ROTULO: Record<string, string> = {
  vrcusto: 'Custo', vrcustoreal: 'Custo real', vrcustorep: 'Custo de reposição',
  vrcustofiscal: 'Custo fiscal', vrcustocsi: 'Custo CSI', pmz: 'PMZ',
  markup: 'Markup', vrvenda: 'Preço de venda', vrvendasug: 'Venda sugerida',
  margeml: 'Margem líquida', margeml2v: 'Margem líquida 2', vendaliq: 'Venda líquida',
  lucroliqv: 'Lucro líquido',
};
const brl = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
const quando = (d: string) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function HistProcNfPage() {
  const mensagem = useMensagem();
  const [codproduto, setCodproduto] = useState('');
  const [codnf, setCodnf] = useState('');
  const [soAlterou, setSoAlterou] = useState(false);
  const [res, setRes] = useState<Resposta | null>(null);
  const [aberto, setAberto] = useState<number | null>(null);

  const buscar = async () => {
    if (!codproduto.trim() && !codnf.trim()) {
      mensagem.erro(new Error('Informe o produto ou a nota.')); return;
    }
    try {
      const p = new URLSearchParams({ limite: '200' });
      if (codproduto.trim()) p.set('codproduto', codproduto.trim());
      if (codnf.trim()) p.set('codnf', codnf.trim());
      if (soAlterou) p.set('so_alterou_custo', 'true');
      const r = await fetch(`${BASE}/precificacao/hist-processamento-nf?${p}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      const dados = (await r.json()) as Resposta;
      setRes(dados);
      setAberto(dados.itens[0]?.codhistprocnf ?? null);
    } catch (e) { mensagem.erro(e); }
  };

  const evento = res?.itens.find((e) => e.codhistprocnf === aberto) ?? null;

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Histórico de processamento da NF" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Por que o custo e o preço do produto mudaram: em que nota, em que data, de quanto para quanto.
          Cada processamento grava um <strong>par antes e depois</strong>, e é a diferença entre os dois que
          responde a pergunta.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&Produto" value={codproduto} onChange={(e) => setCodproduto(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }} /></div>
          <div className="w-40"><Field label="ou &Nota" value={codnf} onChange={(e) => setCodnf(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }} /></div>
          <label className="flex items-center gap-gp-xs pb-2 text-body-sm">
            <input type="checkbox" checked={soAlterou} onChange={(e) => setSoAlterou(e.target.checked)} /> só os que alteraram o custo
          </label>
          <Button label="&Consultar" onClick={() => void buscar()} />
        </div>
        {res && (
          <div className="mt-form-gap flex flex-wrap gap-gp-md text-body-sm">
            <span>{res.resumo.eventos} evento(s)</span>
            <span>alteraram o custo: <strong className="tabular-nums">{res.resumo.alteraram_custo}</strong></span>
            <span>alteraram a venda: <strong className="tabular-nums">{res.resumo.alteraram_venda}</strong></span>
            {res.resumo.sem_par > 0 && (
              <span className="text-fg-danger">sem o estado anterior: {res.resumo.sem_par} — nesses a variação é desconhecida, não zero</span>
            )}
          </div>
        )}
      </section>

      {res && res.itens.length > 0 && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Quando</th><th className="p-pad-xs">Nota</th>
                <th className="p-pad-xs">Produto</th><th className="p-pad-xs">Fornecedor</th>
                <th className="p-pad-xs">Alterou</th><th className="p-pad-xs">Por</th>
              </tr></thead>
              <tbody>{res.itens.map((e) => (
                <tr key={e.codhistprocnf}
                    className={`cursor-pointer border-b border-border hover:bg-bg-muted ${aberto === e.codhistprocnf ? 'bg-bg-muted' : ''}`}
                    onClick={() => setAberto(e.codhistprocnf)}>
                  <td className="p-pad-xs tabular-nums">{quando(e.dthistorico)}</td>
                  <td className="p-pad-xs tabular-nums">{e.nronf ?? e.codnf ?? '—'}{e.serie ? `/${e.serie}` : ''}</td>
                  <td className="p-pad-xs">{e.produto ?? e.codproduto}</td>
                  <td className="p-pad-xs text-fg-muted">{e.fornecedor ?? ''}</td>
                  <td className="p-pad-xs">
                    {e.alterou_custo ? 'custo' : ''}{e.alterou_custo && e.alterou_venda ? ' e ' : ''}{e.alterou_venda ? 'venda' : ''}
                    {!e.alterou_custo && !e.alterou_venda ? '—' : ''}
                  </td>
                  <td className="p-pad-xs text-fg-muted">
                    {[e.por_decomposicao && 'decomposição', e.por_estoque && 'estoque', e.por_cfop && 'CFOP',
                      e.venda_lote && 'lote', e.venda_online && 'online'].filter(Boolean).join(', ') || '—'}
                  </td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      )}

      {evento && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h4 className="mb-form-gap text-body-sm font-semibold">
            A escada de custo neste processamento
            {!evento.tem_par && <span className="ml-2 font-normal text-fg-danger">sem o estado anterior: a variação é desconhecida</span>}
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Degrau</th>
                <th className="p-pad-xs text-right">Antes</th>
                <th className="p-pad-xs text-right">Depois</th>
                <th className="p-pad-xs text-right">Variação</th>
                <th className="p-pad-xs text-right">%</th>
              </tr></thead>
              <tbody>{evento.escada.map((d) => (
                <tr key={d.campo} className={`border-b border-border ${d.mudou ? 'bg-bg-muted' : ''}`}>
                  <td className="p-pad-xs">{ROTULO[d.campo] ?? d.campo}</td>
                  <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(d.antes)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(d.depois)}</td>
                  <td className={`p-pad-xs text-right tabular-nums ${d.mudou ? 'font-semibold' : 'text-fg-muted'}`}>
                    {d.mudou ? (d.variacao > 0 ? '+' : '') + brl(d.variacao) : '—'}
                  </td>
                  <td className={`p-pad-xs text-right tabular-nums ${d.mudou ? 'font-semibold' : 'text-fg-muted'}`}>
                    {d.variacao_pct == null ? '—' : `${d.variacao_pct > 0 ? '+' : ''}${brl(d.variacao_pct)}%`}
                  </td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
