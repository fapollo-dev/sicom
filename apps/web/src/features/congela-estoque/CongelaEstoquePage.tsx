import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * CONGELAR / DESCONGELAR ESTOQUE (`FRMCONGELAESTOQUE`). Dossiê: `uCongelaEstoque.md`.
 * A foto do estoque para o balanço: congelar copia o saldo de cada produto para a coluna congelada;
 * descongelar só levanta a marca — a foto continua gravada, como no legado.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const qt = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dataHora = (v: unknown) => (v == null ? '—' : new Date(String(v)).toLocaleString('pt-BR'));

interface Situacao {
  empresa: { idempresa: number; fantasia: string | null };
  congelado: boolean; operador: number | null; data: string | null;
  estoque: { linhas: number; congeladas: number; divergentes: number; diferencaQtde: number };
  deposito: { linhas: number; congeladas: number };
  historico: Array<{ idcongelamento: number; acao: string; codoperador: number | null; linhas_estoque: number; linhas_deposito: number; data: string }>;
}

export function CongelaEstoquePage() {
  const mensagem = useMensagem();
  const [s, setS] = useState<Situacao | null>(null);
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
  const carregar = async () => { try { setS(await pedir<Situacao>(`${BASE}/cadastro/congela-estoque`)); } catch (e) { mensagem.erro(e); } };
  useEffect(() => { void carregar(); }, []);
  const agir = async (acao: 'congelar' | 'descongelar') => {
    const pergunta = acao === 'congelar'
      ? 'Congelar o estoque desta empresa? O saldo atual de cada produto vira a foto do inventário.'
      : 'Descongelar o estoque? A foto continua gravada; só a marca é levantada.';
    if (!window.confirm(pergunta)) return;
    setOcupado(true);
    try { await pedir(`${BASE}/cadastro/congela-estoque/${acao}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); mensagem.sucesso(acao === 'congelar' ? 'Estoque congelado.' : 'Estoque descongelado.'); await carregar(); }
    catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Congelar estoque" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">A foto do estoque usada pelo balanço. Congelar grava o saldo atual de cada produto na coluna congelada, nas duas tabelas (loja e depósito), e marca a empresa.</p>
        {s && (
          <>
            <div className="flex flex-wrap gap-gp-md text-body-sm">
              <span>{s.empresa.fantasia ?? `Empresa ${s.empresa.idempresa}`}</span>
              <span>Situação <strong className={s.congelado ? 'text-fg-danger' : ''}>{s.congelado ? 'CONGELADO' : 'livre'}</strong></span>
              <span>Último ato {dataHora(s.data)}{s.operador ? ` · operador ${s.operador}` : ''}</span>
            </div>
            <div className="mt-form-gap flex flex-wrap gap-gp-md text-body-sm">
              <span>Estoque <strong className="tabular-nums">{s.estoque.linhas}</strong> linhas · <strong className="tabular-nums">{s.estoque.congeladas}</strong> com foto</span>
              <span className={s.estoque.divergentes > 0 ? 'font-semibold text-fg-danger' : ''}>Divergentes do saldo atual <strong className="tabular-nums">{s.estoque.divergentes}</strong> ({qt(s.estoque.diferencaQtde)} un)</span>
              <span>Depósito <strong className="tabular-nums">{s.deposito.linhas}</strong> linhas · <strong className="tabular-nums">{s.deposito.congeladas}</strong> com foto</span>
            </div>
            <div className="mt-form-gap flex flex-wrap gap-gp-sm">
              <Button label="&Congelar estoque" disabled={ocupado || s.congelado} onClick={() => void agir('congelar')} />
              <Button label="&Descongelar" variant="outline" disabled={ocupado || !s.congelado} onClick={() => void agir('descongelar')} />
            </div>
          </>
        )}
      </section>

      {s && s.historico.length > 0 && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <h4 className="p-pad-xs text-body-sm font-semibold">Histórico</h4>
          <table className="w-full min-w-[600px] border-collapse text-body-sm">
            <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Quando</th><th className="p-pad-xs">Ação</th><th className="p-pad-xs">Operador</th><th className="p-pad-xs text-right">Linhas estoque</th><th className="p-pad-xs text-right">Linhas depósito</th></tr></thead>
            <tbody>{s.historico.map((h) => (
              <tr key={h.idcongelamento} className="border-b border-border">
                <td className="p-pad-xs">{dataHora(h.data)}</td><td className="p-pad-xs">{h.acao}</td><td className="p-pad-xs tabular-nums">{h.codoperador ?? ''}</td>
                <td className="p-pad-xs text-right tabular-nums">{h.linhas_estoque}</td><td className="p-pad-xs text-right tabular-nums">{h.linhas_deposito}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
