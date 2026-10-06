import { useEffect, useState } from 'react';
import { Modal } from '../../shared/ui/Modal';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, getSessao, handle401, setSessao } from '../../shared/auth/session';
import { useMensagem } from '../../shared/mensagem';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface EmpresaTroca { idempresa: number; fantasia: string | null }

async function pedir<T>(caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${caminho}`, { ...init, headers: apiHeaders(init?.body ? { 'content-type': 'application/json' } : undefined) });
  handle401(r);
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
    throw Object.assign(new Error(env.code), { envelope: env });
  }
  return (await r.json()) as T;
}

/**
 * TROCAR DE EMPRESA (Ctrl+E do `TfrmMaster` → `dmPrincipal.TrocarEmpresa(True)` → `frmEmpresas`): as lojas do operador por fantasia;
 * Enter/duplo clique escolhe, Esc fecha sem trocar. A sessão passa a carregar a empresa escolhida e a tela recarrega com ela (no
 * legado, o dataset da empresa é reaberto e o título do menu muda).
 */
export function TrocarEmpresaModal({ onFechar }: { onFechar: () => void }) {
  const mensagem = useMensagem();
  const [empresas, setEmpresas] = useState<EmpresaTroca[]>([]);
  const [sel, setSel] = useState<number | null>(getSessao()?.empresa ?? null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    pedir<EmpresaTroca[]>('/auth/empresas').then(setEmpresas).catch((e) => { mensagem.erro(e); onFechar(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmar = async (empresa = sel) => {
    if (empresa == null || ocupado) return;
    if (empresa === getSessao()?.empresa) { onFechar(); return; }
    setOcupado(true);
    try {
      const r = await pedir<{ token: string; refresh?: string; empresa: number; empresas: never[]; operador: { codoperador: number; nome: string | null; login: string | null } }>(
        '/auth/trocar-empresa', { method: 'POST', body: JSON.stringify({ empresa }) });
      setSessao({ token: r.token, refresh: r.refresh, operador: r.operador, empresa: r.empresa, empresas: r.empresas ?? [] });
      window.location.reload();
    } catch (e) { mensagem.erro(e); setOcupado(false); }
  };

  return (
    <Modal
      open
      onClose={onFechar}
      size="sm"
      title="Empresas"
      description="Escolha a empresa · Enter confirma · Esc fecha"
      primaryAction={{ label: 'OK', onClick: () => void confirmar() }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div
        role="listbox"
        aria-label="Empresas"
        tabIndex={0}
        data-enter="nativo"
        className="flex max-h-80 flex-col overflow-auto rounded-radius-base border border-border"
        onKeyDown={(e) => {
          const i = empresas.findIndex((x) => x.idempresa === sel);
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel(empresas[Math.min(empresas.length - 1, i + 1)]?.idempresa ?? sel); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel(empresas[Math.max(0, i - 1)]?.idempresa ?? sel); }
          if (e.key === 'Enter') { e.preventDefault(); void confirmar(); }
        }}
        ref={(el) => el?.focus()}
      >
        {empresas.map((x) => (
          <div
            key={x.idempresa}
            role="option"
            aria-selected={x.idempresa === sel}
            onClick={() => setSel(x.idempresa)}
            onDoubleClick={() => void confirmar(x.idempresa)}
            className={`cursor-pointer px-pad-sm py-gp-xs text-body-sm ${x.idempresa === sel ? 'bg-bg-subtle font-semibold' : ''}`}
          >
            <span className="tabular-nums">{x.idempresa}</span> — {x.fantasia ?? ''}
          </div>
        ))}
      </div>
    </Modal>
  );
}
