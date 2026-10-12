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
  id: number; idempresa: number; razao_social?: string | null; dir_bal?: string | null; tipo_bal: string; mod_bal?: string | null; campo_setor?: string | null; export_nutricional?: string | null;
  export_receita?: string | null; exporta_tara?: string | null; exporta_rdc429?: string | null;
}
interface EdicaoConfig { id: number | null; idempresa: number | null; dir_bal: string; tipo_bal: string; mod_bal: string; campo_setor: string; export_nutricional: boolean; export_receita: boolean; exporta_tara: boolean; exporta_rdc429: boolean }
// as opções dos rádios do configurador (uConfigExportaBalanca.dfm): rgTipo (padrão AMBAS), rgModelo (padrão PRIX4-N), RGsetor (padrão Código da Balança)
const TIPOS = ['TOLEDO', 'FILIZOLA', 'AMBAS'];
const MODELOS = ['PRIX4-N', 'PRIX4 / PRIX4-R', 'REDE MGVIII', 'PRIX5-N'];
const SETORES = ['Código do Departamento', 'Código da Balança'];
const NOVA: EdicaoConfig = { id: null, idempresa: null, dir_bal: '', tipo_bal: 'AMBAS', mod_bal: 'PRIX4-N', campo_setor: 'Código da Balança', export_nutricional: false, export_receita: false, exporta_tara: false, exporta_rdc429: false };
interface ArquivoBalanca { nome: string; conteudo: string; linhas: number }
interface LoteBalanca { config: number; idempresa: number; pasta: string; modelo: string | null; produtos: number; arquivos: ArquivoBalanca[]; aviso: string | null }
const sn = (v: unknown) => (String(v ?? '').toUpperCase() === 'S' ? 'S' : 'N');

/** baixa o .zip (base64) das várias lojas */
function baixarZip(nome: string, base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

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
 * EXPORTAR PARA BALANÇA (FRMEXPORTABALANCA). A "Lista de empresas configuradas para exportação" traz a config de cada loja que o
 * operador alcança; marque (clique em Selecionar, ou T para todas) e "Exportar" gera os arquivos de cada loja marcada — TXITENS/CADASTRO/
 * ITENSMGV e, com a tabela nutricional, INFNUTRI. Uma loja baixa os .TXT; várias, um .zip com uma pasta por loja (o legado grava cada uma
 * no diretório dela e roda o CargaBalanca.bat da estação — aqui o arquivo vai para o software MGV à mão).
 */
export function ExportaBalancaPage() {
  const mensagem = useMensagem();
  const [configs, setConfigs] = useState<ConfigBalanca[]>([]);
  const [busy, setBusy] = useState(false);
  const [ultimo, setUltimo] = useState<LoteBalanca[] | null>(null);
  const [edicao, setEdicao] = useState<EdicaoConfig | null>(null);
  // a coluna "Selecionar" (cdsDadosSEL — começa desmarcada)
  const [sel, setSel] = useState<Set<number>>(new Set());
  // as lojas do operador para a Empresa do configurador
  const [lojas, setLojas] = useState<Array<{ idempresa: number; fantasia: string | null }>>([]);

  const recarregar = () => req<ConfigBalanca[]>('/cadastro/exporta-balanca/configs').then(setConfigs).catch((e) => mensagem.erro(e));
  useEffect(() => {
    void recarregar();
    req<Array<{ idempresa: number; fantasia: string | null }>>('/auth/empresas').then(setLojas).catch(() => setLojas([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const alternar = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // o Configurador (BtnConfiguraBal → TfrmConfExportaBalanca)
  const editar = (c: ConfigBalanca) => setEdicao({
    id: c.id, idempresa: c.idempresa, dir_bal: c.dir_bal ?? '', tipo_bal: c.tipo_bal, mod_bal: c.mod_bal ?? 'PRIX4-N', campo_setor: c.campo_setor ?? 'Código da Balança',
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

  // o Exportar (btnExportarClick): as linhas marcadas; a loja sem produto avisa e as outras seguem
  const exportar = async () => {
    if (busy) return;
    if (!sel.size) { window.alert('Selecione os registros na grade á exportar e tente novamente!'); return; }
    setBusy(true);
    try {
      const r = await req<{ lotes: LoteBalanca[]; zip: string | null; nomeZip: string | null }>('/cadastro/exporta-balanca/gerar-lote', {
        method: 'POST', body: JSON.stringify({ ids: [...sel] }) });
      for (const l of r.lotes) if (l.aviso) window.alert(l.aviso);
      if (r.zip) baixarZip(r.nomeZip ?? 'Balanca.zip', r.zip);
      else for (const l of r.lotes) for (const a of l.arquivos) baixar(a.nome, a.conteudo);
      setUltimo(r.lotes);
      if (r.lotes.some((l) => l.arquivos.length)) mensagem.sucesso('Arquivos gerados com êxito.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Exportar para Balança" />
      <div className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <small className="text-fg-muted">Gera os arquivos de PLU (código + preço + validade + descrição) das balanças Toledo. Produtos de balança (balança='S', código de barras ≤ 6 dígitos, preço &gt; 0); preço = promoção se ativa. Baixe e carregue no software MGV.</small>
      </div>

      <section className="flex flex-col gap-gp-xs rounded-radius-md border border-border bg-bg-surface">
        <div className="px-pad-sm pt-pad-xs text-body-sm font-semibold text-fg-muted">Lista de empresas configuradas para exportação</div>
        {/* a tecla T marca todas (DbGridDadosKeyDown) */}
        <div className="overflow-x-auto" tabIndex={0} aria-label="Lista de empresas configuradas para exportação"
          onKeyDown={(e) => { if (e.key === 't' || e.key === 'T') { e.preventDefault(); setSel(new Set(configs.map((c) => c.id))); } }}>
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="p-pad-xs">Selecionar</th><th className="p-pad-xs">Empresa</th><th className="p-pad-xs">Razão social</th>
                <th className="p-pad-xs">Tipo Balança</th><th className="p-pad-xs">Modelo balança</th><th className="p-pad-xs">Ex.Tabela Nutricional</th>
                <th className="p-pad-xs">Ex.Receita</th><th className="p-pad-xs">Ex. tara</th><th className="p-pad-xs">Campo do setor</th>
                <th className="p-pad-xs">Diretório</th><th className="p-pad-xs" />
              </tr>
            </thead>
            <tbody>
              {configs.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="p-pad-xs"><input type="checkbox" aria-label={`Selecionar a empresa ${c.idempresa}`} checked={sel.has(c.id)} onChange={() => alternar(c.id)} /></td>
                  <td className="p-pad-xs tabular-nums">{c.idempresa}</td>
                  <td className="p-pad-xs">{c.razao_social ?? '—'}</td>
                  <td className="p-pad-xs">{c.tipo_bal}</td>
                  <td className="p-pad-xs">{c.mod_bal ?? '—'}</td>
                  <td className="p-pad-xs">{sn(c.export_nutricional)}</td>
                  <td className="p-pad-xs">{sn(c.export_receita)}</td>
                  <td className="p-pad-xs">{sn(c.exporta_tara)}</td>
                  <td className="p-pad-xs">{c.campo_setor ?? '—'}</td>
                  <td className="p-pad-xs text-fg-muted">{c.dir_bal ?? '—'}</td>
                  <td className="p-pad-xs text-right whitespace-nowrap">
                    <Button label="Editar" variant="ghost" disabled={busy} onClick={() => editar(c)} />
                    <Button label="Excluir" variant="ghost" disabled={busy} onClick={() => void excluirConfig(c)} />
                  </td>
                </tr>
              ))}
              {!configs.length && <tr><td colSpan={11} className="p-pad-md text-fg-muted">Nenhuma empresa configurada para exportação.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-pad-sm pb-pad-xs text-body-xs text-fg-muted">* Pressione T para selecionar todas as empresas</div>
      </section>

      <div className="flex flex-wrap gap-gp-sm">
        <Button label="&Exportar" variant="soft" disabled={busy || !configs.length} onClick={() => void exportar()} />
      </div>

      <div><Button label="&Configurador — nova balança" variant="soft" disabled={busy} onClick={() => setEdicao({ ...NOVA })} /></div>
      {edicao && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <strong>{edicao.id != null ? `Configuração #${edicao.id}` : 'Nova configuração'}</strong>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
            <SelectField label="Em&presa" value={String(edicao.idempresa ?? '')} onChange={(v) => setEdicao({ ...edicao, idempresa: v ? Number(v) : null })}
              options={[{ value: '', label: '(a da sessão)' }, ...lojas.map((l) => ({ value: String(l.idempresa), label: `${l.idempresa} — ${l.fantasia ?? ''}` }))]} />
            <div className="sm:col-span-2"><Field label="&Diretório" value={edicao.dir_bal} maxLength={200} onChange={(e) => setEdicao({ ...edicao, dir_bal: e.target.value })} /></div>
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
          <div className="text-body-sm font-semibold text-fg-muted">Última exportação</div>
          {ultimo.map((l) => (
            <div key={l.config} className="mt-1 text-body-sm">
              <div>Empresa {l.idempresa} ({l.pasta}) — {l.aviso ?? `${l.produtos} produto(s)${l.modelo ? ` · ${l.modelo}` : ''}`}</div>
              <ul>
                {l.arquivos.map((a) => (
                  <li key={a.nome} className="flex items-center gap-gp-sm py-0.5">
                    <span className="tabular-nums">{a.nome} — {a.linhas} linha(s)</span>
                    <Button label="Baixar de novo" variant="ghost" onClick={() => baixar(a.nome, a.conteudo)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
