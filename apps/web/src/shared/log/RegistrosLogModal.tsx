import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@apollosg/design-system';
import { apiHeaders, handle401 } from '../auth/session';
import { Button } from '../ui/Button';
import { useMensagem } from '../mensagem';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface LinhaLog {
  idlog: number;
  acao: string;
  formulario: string | null;
  tabela: string | null;
  chave: string | null;
  valor: number | null;
  usuario: string | null;
  datahora: string;
  historico: string | null;
  idempresa: number | null;
}

/** o que a tela passa ao abrir o log (ChamaTelaRegistrosLog, uLog.pas:563) */
export interface LogDaTela {
  /** o form (RBAC) da tela que abre — o gate dela vale para o log */
  form: string;
  /** a coluna-chave do legado (ex.: 'CODPARCEIRO', 'CODOPERADOR') */
  chave: string;
  /** mostra a coluna Empresa (o controle de permissões mostra) */
  exibirEmpresa?: boolean;
  /** mostra o código do registro no lugar do número do log (quando abre para todos os registros) */
  exibirValor?: boolean;
  /** filtra por ação ('Excluiu' na promoção acumulativa) */
  acao?: 'Inseriu' | 'Alterou' | 'Excluiu';
}

const hojeLocal = (deslocDias = 0) => {
  const d = new Date(Date.now() - deslocDias * 86400000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const fmtDataHora = (s: string) => {
  const [d, h] = s.split(' ');
  const [a, m, dia] = d.split('-');
  return `${dia}/${m}/${a} ${h ?? ''}`.trim();
};

/**
 * REGISTROS DE LOG (frmRegistrosLog, uRegistrosLog.pas) — o histórico que o usuário vê a partir da tela: quem inseriu
 * ou alterou o registro, quando, e o valor anterior/atual de cada campo. Período padrão: os últimos 30 dias (FormShow).
 * `valor` ausente ou 0 = todos os registros da chave.
 */
export function RegistrosLogModal({ log, valor, onFechar }: { log: LogDaTela; valor?: number | null; onFechar: () => void }) {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(hojeLocal(30));
  const [dtfim, setDtfim] = useState(hojeLocal(0));
  const [linhas, setLinhas] = useState<LinhaLog[]>([]);
  const [carregando, setCarregando] = useState(false);

  const filtrar = useCallback(async () => {
    setCarregando(true);
    try {
      const qs = new URLSearchParams({ form: log.form, chave: log.chave, dtini, dtfim });
      if (valor) qs.set('valor', String(valor));
      if (log.acao) qs.set('acao', log.acao);
      const res = await fetch(`${BASE}/cadastro/registros-log?${qs.toString()}`, { headers: apiHeaders() });
      handle401(res);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(body?.code ?? res.statusText), { envelope: body, status: res.status, body });
      setLinhas((body.linhas ?? []) as LinhaLog[]);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [log.form, log.chave, log.acao, valor, dtini, dtfim, mensagem]);

  // abre já filtrado nos últimos 30 dias (FormShow) — depois, só pelo botão Filtrar
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void filtrar(), []);

  return (
    <Modal open onClose={onFechar} size="lg" title="Registros de log" secondaryAction={{ label: 'Fechar', onClick: onFechar }}>
      <div className="flex flex-col gap-gp-sm">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <label className="flex flex-col gap-gp-2xs text-body-sm">
            <span className="text-fg-muted">De</span>
            <input type="date" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={dtini} onChange={(e) => setDtini(e.target.value)} />
          </label>
          <label className="flex flex-col gap-gp-2xs text-body-sm">
            <span className="text-fg-muted">Até</span>
            <input type="date" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={dtfim} onChange={(e) => setDtfim(e.target.value)} />
          </label>
          <Button label={carregando ? 'Filtrando…' : '&Filtrar'} variant="soft" disabled={carregando} onClick={() => void filtrar()} />
          <span className="ml-auto text-body-sm text-fg-muted">{linhas.length} registro(s)</span>
        </div>
        <div className="max-h-[60vh] overflow-auto rounded-radius-base border border-border">
          <table className="w-full text-body-sm">
            <thead className="sticky top-0 bg-bg-subtle text-left">
              <tr>
                <th className="px-pad-sm py-pad-xs">{log.exibirValor ? 'Chave' : 'Log'}</th>
                <th className="px-pad-sm py-pad-xs">Data/hora</th>
                <th className="px-pad-sm py-pad-xs">Usuário</th>
                <th className="px-pad-sm py-pad-xs">Ação</th>
                {log.exibirEmpresa && <th className="px-pad-sm py-pad-xs">Empresa</th>}
                <th className="px-pad-sm py-pad-xs">Tela</th>
                <th className="px-pad-sm py-pad-xs">Histórico</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.idlog} className="border-t border-border align-top">
                  <td className="px-pad-sm py-pad-xs tabular-nums">{log.exibirValor ? l.valor : l.idlog}</td>
                  <td className="px-pad-sm py-pad-xs whitespace-nowrap tabular-nums">{fmtDataHora(l.datahora)}</td>
                  <td className="px-pad-sm py-pad-xs">{l.usuario}</td>
                  <td className="px-pad-sm py-pad-xs">{l.acao}</td>
                  {log.exibirEmpresa && <td className="px-pad-sm py-pad-xs tabular-nums">{l.idempresa ?? ''}</td>}
                  <td className="px-pad-sm py-pad-xs">{l.formulario}</td>
                  <td className="px-pad-sm py-pad-xs whitespace-pre-wrap font-mono text-[12px]">{l.historico}</td>
                </tr>
              ))}
              {!linhas.length && !carregando && (
                <tr><td colSpan={log.exibirEmpresa ? 7 : 6} className="px-pad-sm py-pad-md text-center text-fg-muted">Nenhum registro no período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
