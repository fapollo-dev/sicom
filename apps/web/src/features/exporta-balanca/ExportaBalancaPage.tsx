import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

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

interface ConfigBalanca { id: number; dir_bal?: string | null; tipo_bal: string; mod_bal?: string | null; campo_setor?: string | null; export_nutricional?: string | null }
interface ArquivoBalanca { nome: string; conteudo: string; linhas: number }

/** baixa um .txt (uma etiqueta <a download> por arquivo). */
function baixar(nome: string, conteudo: string) {
  const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * EXPORTAR PARA BALANÇA (FRMEXPORTABALANCA) — corte-1 TOLEDO. Lista as configs de balança da empresa e gera os
 * arquivos de PLU (TXITENS/CADASTRO/ITENSMGV — código+preço+validade+descrição) p/ download; o software MGV da
 * balança carrega. Preço = promo se ativa, senão venda (MULTI_PRECO). Filizola/nutricional = cortes futuros.
 */
export function ExportaBalancaPage() {
  const mensagem = useMensagem();
  const [configs, setConfigs] = useState<ConfigBalanca[]>([]);
  const [busy, setBusy] = useState(false);
  const [ultimo, setUltimo] = useState<{ config: number; produtos: number; arquivos: ArquivoBalanca[] } | null>(null);

  useEffect(() => {
    void req<ConfigBalanca[]>('/cadastro/exporta-balanca/configs').then(setConfigs).catch((e) => mensagem.erro(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gerar = async (cfg: ConfigBalanca) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ config: number; modelo: string; produtos: number; arquivos: ArquivoBalanca[] }>(`/cadastro/exporta-balanca/gerar/${cfg.id}`, { method: 'POST' });
      setUltimo(r);
      for (const a of r.arquivos) baixar(a.nome, a.conteudo);
      mensagem.sucesso(`${r.produtos} produto(s) → ${r.arquivos.length} arquivo(s) gerado(s) e baixado(s) (${r.modelo}).`);
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Exportar para Balança" />
      <div className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <small className="text-fg-muted">Gera os arquivos de PLU (código + preço + validade + descrição) das balanças Toledo. Produtos de balança (balança='S', código de barras ≤ 6 dígitos, preço &gt; 0); preço = promoção se ativa. Baixe e carregue no software MGV.</small>
      </div>

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs">Config</th><th className="p-pad-xs">Tipo</th><th className="p-pad-xs">Modelo</th>
              <th className="p-pad-xs">Diretório (legado)</th><th className="p-pad-xs" />
            </tr>
          </thead>
          <tbody>
            {configs.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="p-pad-xs tabular-nums">#{c.id}</td>
                <td className="p-pad-xs">{c.tipo_bal}</td>
                <td className="p-pad-xs">{c.mod_bal ?? '—'}</td>
                <td className="p-pad-xs text-fg-muted">{c.dir_bal ?? '—'}</td>
                <td className="p-pad-xs text-right"><Button label="&Gerar arquivos" variant="soft" disabled={busy} onClick={() => void gerar(c)} /></td>
              </tr>
            ))}
            {!configs.length && <tr><td colSpan={5} className="p-pad-md text-fg-muted">Nenhuma config de balança nesta empresa.</td></tr>}
          </tbody>
        </table>
      </div>

      {ultimo && (
        <div className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="text-body-sm font-semibold text-fg-muted">Última geração — config #{ultimo.config} · {ultimo.produtos} produto(s)</div>
          <ul className="mt-1 text-body-sm">
            {ultimo.arquivos.map((a) => (
              <li key={a.nome} className="flex items-center gap-gp-sm py-0.5">
                <span className="tabular-nums">{a.nome} — {a.linhas} linha(s)</span>
                <Button label="Baixar de novo" variant="ghost" onClick={() => baixar(a.nome, a.conteudo)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
