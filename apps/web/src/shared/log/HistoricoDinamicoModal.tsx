import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { apiHeaders, handle401 } from '../auth/session';
import { useMensagem } from '../mensagem';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface LinhaHistoricoDinamico {
  codhistorico: number;
  campo: string;
  valor_anterior: string | null;
  valor_atual: string | null;
  data: string;
  codoperador: number | null;
  nome: string | null;
  codempresa: number | null;
  historico: string | null;
}

/** o que a tela passa ao abrir o histórico (FTabela/FValor_Chave/FCampoDefault/FEmpresa + o lblIten e o título) */
export interface HistoricoDaTela {
  /** a tabela do histórico (ex.: 'MULTI_PRECO') — a chave é a do servidor */
  tabela: string;
  /** o campo que abre escolhido (FCampoDefault), se o registro tiver histórico nele */
  campoDefault?: string;
}

const fmtData = (s: string) => {
  const [d, h] = s.split(' ');
  const [a, m, dia] = d.split('-');
  return `${dia}/${m}/${a} ${h ?? ''}`.trim();
};

/**
 * HISTÓRICO DINÂMICO (`TfrmHistoricoDinamico`, uHistoricoDinamico.pas) — campo a campo, o que mudou num registro: o combo "Campo" traz os
 * campos que têm histórico (SetaCampos) e abre no campo padrão; a grade mostra o valor anterior e o modificado, a data, o operador, a loja e
 * o histórico — NA LOJA que a tela passou (`empresa`; ausente = a do login).
 */
export function HistoricoDinamicoModal({ historico, valor, empresa, titulo, item, onFechar }: {
  historico: HistoricoDaTela; valor: number | string; empresa?: number | null; titulo: string; item?: string; onFechar: () => void;
}) {
  const mensagem = useMensagem();
  const [campos, setCampos] = useState<string[]>([]);
  const [campo, setCampo] = useState<string>('');
  const [linhas, setLinhas] = useState<LinhaHistoricoDinamico[]>([]);
  const [carregando, setCarregando] = useState(false);

  const consultar = useCallback(async (c: string) => {
    setCarregando(true);
    try {
      const qs = new URLSearchParams();
      if (c) qs.set('campo', c);
      if (empresa) qs.set('empresa', String(empresa));
      const res = await fetch(`${BASE}/cadastro/historico-dinamico/${encodeURIComponent(historico.tabela)}/${encodeURIComponent(String(valor))}?${qs.toString()}`, { headers: apiHeaders() });
      handle401(res);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(body?.code ?? res.statusText), { envelope: body, status: res.status, body });
      setCampos((body.campos ?? []) as string[]);
      setLinhas((body.linhas ?? []) as LinhaHistoricoDinamico[]);
      return (body.campos ?? []) as string[];
    } catch (e) {
      mensagem.erro(e);
      return [];
    } finally {
      setCarregando(false);
    }
  }, [historico.tabela, valor, empresa, mensagem]);

  // FormShow: SetaCampos; o campo padrão abre escolhido e consultado se o registro tiver histórico nele
  useEffect(() => {
    const padrao = (historico.campoDefault ?? '').trim().toUpperCase();
    void (async () => {
      const lista = await consultar(padrao);
      setCampo(padrao && lista.includes(padrao) ? padrao : '');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trocar = (c: string) => { setCampo(c); if (c) void consultar(c); else setLinhas([]); };

  return (
    <Modal open onClose={onFechar} size="lg" title={`Histórico ${titulo}`} secondaryAction={{ label: 'Fechar', onClick: onFechar }}>
      <div className="flex flex-col gap-gp-sm">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <label className="flex flex-col gap-gp-2xs text-body-sm">
            <span className="text-fg-muted">Campo</span>
            <select aria-label="Campo" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={campo} onChange={(e) => trocar(e.target.value)}>
              <option value="" />
              {campos.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {item && <span className="text-body-sm font-semibold">{item}</span>}
          <span className="ml-auto text-body-sm text-fg-muted">{carregando ? 'Carregando…' : `${linhas.length} registro(s)`}</span>
        </div>
        <div className="max-h-[60vh] overflow-auto rounded-radius-base border border-border">
          <table className="w-full text-body-sm">
            <thead className="sticky top-0 bg-bg-subtle text-left">
              <tr>
                <th className="px-pad-sm py-pad-xs">Campo</th>
                <th className="px-pad-sm py-pad-xs">Valor Anterior</th>
                <th className="px-pad-sm py-pad-xs">Valor Modificado</th>
                <th className="px-pad-sm py-pad-xs">Data</th>
                <th className="px-pad-sm py-pad-xs">Cód. Operador</th>
                <th className="px-pad-sm py-pad-xs">Nome Operador</th>
                <th className="px-pad-sm py-pad-xs">Empresa</th>
                <th className="px-pad-sm py-pad-xs">Histórico</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.codhistorico} className="border-t border-border align-top">
                  <td className="px-pad-sm py-pad-xs">{l.campo}</td>
                  <td className="px-pad-sm py-pad-xs tabular-nums">{l.valor_anterior ?? ''}</td>
                  <td className="px-pad-sm py-pad-xs tabular-nums">{l.valor_atual ?? ''}</td>
                  <td className="px-pad-sm py-pad-xs whitespace-nowrap tabular-nums">{fmtData(l.data)}</td>
                  <td className="px-pad-sm py-pad-xs tabular-nums">{l.codoperador ?? ''}</td>
                  <td className="px-pad-sm py-pad-xs">{l.nome ?? ''}</td>
                  <td className="px-pad-sm py-pad-xs tabular-nums">{l.codempresa ?? ''}</td>
                  <td className="px-pad-sm py-pad-xs">{l.historico ?? ''}</td>
                </tr>
              ))}
              {!linhas.length && !carregando && (
                <tr><td colSpan={8} className="px-pad-sm py-pad-md text-center text-fg-muted">{campo ? 'Nenhuma alteração deste campo na loja.' : 'Escolha o campo.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
