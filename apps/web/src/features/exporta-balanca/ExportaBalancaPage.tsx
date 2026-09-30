import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
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

interface ConfigBalanca {
  id: number; dir_bal?: string | null; tipo_bal: string; mod_bal?: string | null; campo_setor?: string | null; export_nutricional?: string | null;
  export_receita?: string | null; exporta_tara?: string | null; exporta_rdc429?: string | null;
}
interface EdicaoConfig { id: number | null; dir_bal: string; tipo_bal: string; mod_bal: string; campo_setor: string; export_nutricional: boolean; export_receita: boolean; exporta_tara: boolean; exporta_rdc429: boolean }
// as opções dos rádios do configurador (uConfigExportaBalanca.dfm): rgTipo (padrão AMBAS), rgModelo (padrão PRIX4-N), RGsetor (padrão Código da Balança)
const TIPOS = ['TOLEDO', 'FILIZOLA', 'AMBAS'];
const MODELOS = ['PRIX4-N', 'PRIX4 / PRIX4-R', 'REDE MGVIII', 'PRIX5-N'];
const SETORES = ['Código do Departamento', 'Código da Balança'];
const NOVA: EdicaoConfig = { id: null, dir_bal: '', tipo_bal: 'AMBAS', mod_bal: 'PRIX4-N', campo_setor: 'Código da Balança', export_nutricional: false, export_receita: false, exporta_tara: false, exporta_rdc429: false };
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
  const [edicao, setEdicao] = useState<EdicaoConfig | null>(null);

  const recarregar = () => req<ConfigBalanca[]>('/cadastro/exporta-balanca/configs').then(setConfigs).catch((e) => mensagem.erro(e));
  useEffect(() => {
    void recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // o Configurador (BtnConfiguraBal → TfrmConfExportaBalanca)
  const editar = (c: ConfigBalanca) => setEdicao({
    id: c.id, dir_bal: c.dir_bal ?? '', tipo_bal: c.tipo_bal, mod_bal: c.mod_bal ?? 'PRIX4-N', campo_setor: c.campo_setor ?? 'Código da Balança',
    export_nutricional: c.export_nutricional === 'S', export_receita: c.export_receita === 'S', exporta_tara: c.exporta_tara === 'S', exporta_rdc429: c.exporta_rdc429 === 'S',
  });
  const salvarConfig = async () => {
    if (!edicao || busy) return;
    setBusy(true);
    try {
      await req('/cadastro/exporta-balanca/configs', { method: 'POST', body: JSON.stringify(edicao) });
      mensagem.sucesso('Configuração salva com sucesso!');
      setEdicao(null);
      await recarregar();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  const excluirConfig = async (c: ConfigBalanca) => {
    if (busy || !window.confirm(`Excluir a configuração #${c.id}?`)) return;
    setBusy(true);
    try { await req(`/cadastro/exporta-balanca/configs/${c.id}`, { method: 'DELETE' }); await recarregar(); }
    catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

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
                <td className="p-pad-xs text-right whitespace-nowrap">
                  <Button label="&Gerar arquivos" variant="soft" disabled={busy} onClick={() => void gerar(c)} />
                  <Button label="Editar" variant="ghost" disabled={busy} onClick={() => editar(c)} />
                  <Button label="Excluir" variant="ghost" disabled={busy} onClick={() => void excluirConfig(c)} />
                </td>
              </tr>
            ))}
            {!configs.length && <tr><td colSpan={5} className="p-pad-md text-fg-muted">Nenhuma config de balança nesta empresa.</td></tr>}
          </tbody>
        </table>
      </div>

      <div><Button label="&Configurador — nova balança" variant="soft" disabled={busy} onClick={() => setEdicao({ ...NOVA })} /></div>
      {edicao && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <strong>{edicao.id != null ? `Configuração #${edicao.id}` : 'Nova configuração'}</strong>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
            <div className="sm:col-span-3"><Field label="&Diretório" value={edicao.dir_bal} maxLength={200} onChange={(e) => setEdicao({ ...edicao, dir_bal: e.target.value })} /></div>
            <SelectField label="&Balança" value={edicao.tipo_bal} onChange={(v) => setEdicao({ ...edicao, tipo_bal: v })} options={TIPOS.map((t) => ({ value: t, label: t }))} />
            <SelectField label="&Modelo" value={edicao.mod_bal} onChange={(v) => setEdicao({ ...edicao, mod_bal: v })} options={MODELOS.map((t) => ({ value: t, label: t }))} />
            <SelectField label="Campo do &setor" value={edicao.campo_setor} onChange={(v) => setEdicao({ ...edicao, campo_setor: v })} options={SETORES.map((t) => ({ value: t, label: t }))} />
          </div>
          <div className="flex flex-wrap gap-gp-md text-body-sm">
            {([['export_nutricional', 'Exportar tabela nutricional'], ['export_receita', 'Exportar receita'], ['exporta_tara', 'Exportar tara'], ['exporta_rdc429', 'Exportar RDC 429']] as const).map(([k, rot]) => (
              <label key={k} className="flex items-center gap-gp-xs"><input type="checkbox" checked={edicao[k]} onChange={(e) => setEdicao({ ...edicao, [k]: e.target.checked })} />{rot}</label>
            ))}
          </div>
          <div className="flex gap-gp-sm">
            <Button label="&Salvar" variant="soft" disabled={busy} onClick={() => void salvarConfig()} />
            <Button label="Cancelar" variant="ghost" disabled={busy} onClick={() => setEdicao(null)} />
          </div>
        </section>
      )}

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
