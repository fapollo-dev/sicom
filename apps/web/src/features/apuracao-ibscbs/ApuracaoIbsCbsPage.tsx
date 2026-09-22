import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * APURAÇÃO DE IBS/CBS (corte-3 da reforma, mig 281). Dossiê `uCadIBSCBS.md` §13.
 *
 * A tela tem DUAS colunas de resultado porque os dois tributos se apuram separadamente: a CBS é federal e
 * o IBS é dos Estados e Municípios. Não existe "total" aqui, e isso é deliberado — somá-los daria um
 * número que não corresponde a imposto nenhum.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Apuracao = {
  codapuracao_ibscbs: number; competencia: string; data_inicio: string; data_fim: string; fechada: string;
  base_debito: number; ibs_debito: number; cbs_debito: number; notas_debito: number;
  base_credito: number; ibs_credito: number; cbs_credito: number; notas_credito: number;
  ibs_saldo_anterior: number; cbs_saldo_anterior: number;
  ibs_a_recolher: number; ibs_saldo_credor: number;
  cbs_a_recolher: number; cbs_saldo_credor: number;
  ibs_cred_presumido: number; cbs_cred_presumido: number;
  ibs_suspenso: number; cbs_suspenso: number;
  ibs_retido_split: number; cbs_retido_split: number;
};
type Detalhe = {
  codnf: number; direcao: string; nronf: string | null; serie: string | null; dtcontabil: string | null;
  parceiro: string | null; base: number; ibs: number; cbs: number; itens: number;
};

const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const comp = (c: string) => `${c.slice(4)}/${c.slice(0, 4)}`;

export function ApuracaoIbsCbsPage() {
  const mensagem = useMensagem();
  const hoje = new Date();
  const [competencia, setCompetencia] = useState(
    `${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, '0')}`,
  );
  const [apuracoes, setApuracoes] = useState<Apuracao[]>([]);
  const [detalhe, setDetalhe] = useState<Detalhe[]>([]);
  const [ocupado, setOcupado] = useState(false);

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

  const carregar = async (c?: string) => {
    try {
      const p = new URLSearchParams();
      if (c) p.set('competencia', c);
      const r = await pedir<{ apuracoes: Apuracao[]; detalhe: Detalhe[] }>(`${BASE}/fiscal/apuracao-ibscbs?${p}`);
      setApuracoes(r.apuracoes); setDetalhe(r.detalhe);
    } catch (e) { mensagem.erro(e); }
  };
  useEffect(() => { void carregar(); }, []);

  const acao = async (rota: 'processar' | 'fechar', corpo: Record<string, unknown>) => {
    setOcupado(true);
    try {
      await pedir(`${BASE}/fiscal/apuracao-ibscbs/${rota}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
      });
      mensagem.sucesso(rota === 'fechar' ? 'Competência fechada.' : 'Apuração processada.');
      await carregar(String(corpo.competencia));
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const atual = apuracoes[0];

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Apuração de IBS/CBS" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Débito das saídas menos crédito das entradas, por competência. <strong>Os dois tributos se apuram
          separadamente</strong> e um não compensa o outro: a CBS é federal e o IBS é dos Estados e
          Municípios. Por isso não há total — cada coluna fecha a sua conta.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-36">
            <Field label="&Competência (AAAAMM)" value={competencia} maxLength={6}
              onChange={(e) => setCompetencia(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') void carregar(competencia); }} />
          </div>
          <Button label="&Consultar" onClick={() => void carregar(competencia)} />
          <Button label="&Processar" variant="outline" disabled={ocupado}
            onClick={() => void acao('processar', { competencia, reprocessar: false })} />
          <Button label="&Reprocessar" variant="ghost" disabled={ocupado}
            onClick={() => void acao('processar', { competencia, reprocessar: true })} />
          <Button label="&Fechar competência" variant="ghost" disabled={ocupado}
            onClick={() => { if (window.confirm('Fechar a competência? Depois disso ela não se reprocessa.')) void acao('fechar', { competencia }); }} />
        </div>
        <p className="mt-form-gap text-body-sm text-fg-muted">
          O débito de cupom não entra: nenhuma venda de NFC-e carrega grupo IBS/CBS hoje.
        </p>
      </section>

      {atual && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="mb-form-gap flex flex-wrap items-center gap-gp-sm">
            <h4 className="text-body-sm font-semibold">Competência {comp(atual.competencia)}</h4>
            {atual.fechada === 'S' && <span className="text-body-sm text-fg-muted">fechada</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs" />
                <th className="p-pad-xs text-right">IBS</th>
                <th className="p-pad-xs text-right">CBS</th>
                <th className="p-pad-xs text-right">Base</th>
                <th className="p-pad-xs text-right">Notas</th>
              </tr></thead>
              <tbody>
                <tr className="border-b border-border">
                  <td className="p-pad-xs">Débito (saídas)</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.ibs_debito)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.cbs_debito)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.base_debito)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{atual.notas_debito}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="p-pad-xs">Crédito (entradas)</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.ibs_credito)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.cbs_credito)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.base_credito)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{atual.notas_credito}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="p-pad-xs">Crédito presumido</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.ibs_cred_presumido)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.cbs_cred_presumido)}</td>
                  <td className="p-pad-xs text-fg-muted" colSpan={2}>crédito sem imposto pago na etapa anterior</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="p-pad-xs">Retido no split</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.ibs_retido_split)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.cbs_retido_split)}</td>
                  <td className="p-pad-xs text-fg-muted" colSpan={2}>já separado na liquidação — abate o a recolher</td>
                </tr>
                <tr className="border-b border-border text-fg-muted">
                  <td className="p-pad-xs">Suspenso / diferido</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.ibs_suspenso)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.cbs_suspenso)}</td>
                  <td className="p-pad-xs" colSpan={2}>não é imposto a pagar — é controle</td>
                </tr>
                <tr className="border-b border-border text-fg-muted">
                  <td className="p-pad-xs">Saldo credor anterior</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.ibs_saldo_anterior)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.cbs_saldo_anterior)}</td>
                  <td className="p-pad-xs" colSpan={2} />
                </tr>
                <tr className="border-b border-border font-semibold">
                  <td className="p-pad-xs">A recolher</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.ibs_a_recolher)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.cbs_a_recolher)}</td>
                  <td className="p-pad-xs" colSpan={2} />
                </tr>
                <tr className="font-semibold">
                  <td className="p-pad-xs">Saldo credor a transportar</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.ibs_saldo_credor)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(atual.cbs_saldo_credor)}</td>
                  <td className="p-pad-xs" colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {detalhe.length > 0 && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h4 className="mb-form-gap text-body-sm font-semibold">Notas da competência</h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Direção</th><th className="p-pad-xs">Nota</th>
                <th className="p-pad-xs">Data</th><th className="p-pad-xs">Parceiro</th>
                <th className="p-pad-xs text-right">Base</th><th className="p-pad-xs text-right">IBS</th>
                <th className="p-pad-xs text-right">CBS</th><th className="p-pad-xs text-right">Itens</th>
              </tr></thead>
              <tbody>{detalhe.map((d) => (
                <tr key={`${d.direcao}-${d.codnf}`} className="border-b border-border">
                  <td className="p-pad-xs">{d.direcao === 'E' ? 'crédito' : 'débito'}</td>
                  <td className="p-pad-xs tabular-nums">{d.nronf ?? d.codnf}{d.serie ? `/${d.serie}` : ''}</td>
                  <td className="p-pad-xs text-fg-muted">{d.dtcontabil ? String(d.dtcontabil).slice(0, 10) : ''}</td>
                  <td className="p-pad-xs">{d.parceiro ?? ''}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(d.base)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(d.ibs)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(d.cbs)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{d.itens}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      )}

      {apuracoes.length > 1 && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h4 className="mb-form-gap text-body-sm font-semibold">Competências anteriores</h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Competência</th><th className="p-pad-xs text-right">IBS a recolher</th>
                <th className="p-pad-xs text-right">IBS credor</th><th className="p-pad-xs text-right">CBS a recolher</th>
                <th className="p-pad-xs text-right">CBS credor</th><th className="p-pad-xs">Situação</th>
              </tr></thead>
              <tbody>{apuracoes.map((a) => (
                <tr key={a.codapuracao_ibscbs} className="cursor-pointer border-b border-border hover:bg-bg-muted"
                    onClick={() => { setCompetencia(a.competencia); void carregar(a.competencia); }}>
                  <td className="p-pad-xs tabular-nums">{comp(a.competencia)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(a.ibs_a_recolher)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(a.ibs_saldo_credor)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(a.cbs_a_recolher)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(a.cbs_saldo_credor)}</td>
                  <td className="p-pad-xs text-fg-muted">{a.fechada === 'S' ? 'fechada' : 'aberta'}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
