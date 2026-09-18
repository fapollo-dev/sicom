import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * MOTIVOS DO AJUSTE DE ESTOQUE (`FRMMOTIVO`). Dossiê: `uMotivo.md`.
 * A tabela `MOTIVOS` do legado — a que o ajuste de estoque aponta. Não confundir com "Motivos de operação",
 * que é do scrap. Exclusão é lógica: o motivo sai do combo e os ajustes antigos continuam íntegros.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
type Motivo = { codmotivo: number; descricao: string; indr: string; ajustes: number };

export function MotivosPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<Motivo[]>([]);
  const [excluidos, setExcluidos] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [descricao, setDescricao] = useState('');
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
  const carregar = async (comExcluidos = excluidos) => { try { setLista(await pedir<Motivo[]>(`${BASE}/cadastro/motivos${comExcluidos ? '?excluidos=S' : ''}`)); } catch (e) { mensagem.erro(e); } };
  useEffect(() => { void carregar(); }, []);
  const novo = () => { setSel(null); setDescricao(''); };
  const gravar = async () => {
    setOcupado(true);
    try {
      await pedir(`${BASE}/cadastro/motivos${sel ? `/${sel}` : ''}`, { method: sel ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ descricao }) });
      mensagem.sucesso('Motivo gravado.'); novo(); await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const excluir = async () => {
    if (!sel || !window.confirm('Excluir este motivo? Ele sai do combo do ajuste; os ajustes já feitos continuam.')) return;
    try { await pedir(`${BASE}/cadastro/motivos/${sel}`, { method: 'DELETE' }); mensagem.sucesso('Motivo excluído.'); novo(); await carregar(); } catch (e) { mensagem.erro(e); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Motivos de ajuste de estoque" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">Os motivos que a tela de ajuste de estoque oferece. É outra tabela dos "Motivos de operação" (esses são do scrap). No cliente são dois vivos: INVENTARIO ROTATIVO (999) e PERCA INDENTIFICADA (1).</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-96"><Field label="&Descrição" value={descricao} maxLength={100} onChange={(e) => setDescricao(e.target.value)} /></div>
          <Button label={sel ? '&Gravar' : '&Incluir'} disabled={ocupado || !descricao.trim()} onClick={() => void gravar()} />
          <Button label="&Novo" variant="outline" onClick={novo} />
          {sel && <Button label="E&xcluir" variant="ghost" onClick={() => void excluir()} />}
          <label className="flex items-center gap-1 text-body-sm text-fg-muted"><input type="checkbox" checked={excluidos} onChange={(e) => { setExcluidos(e.target.checked); void carregar(e.target.checked); }} /> mostrar excluídos</label>
        </div>
      </section>
      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full min-w-[500px] border-collapse text-body-sm">
          <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Código</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs text-right">Ajustes</th><th className="p-pad-xs">Situação</th></tr></thead>
          <tbody>{lista.map((m) => (
            <tr key={m.codmotivo} className={`cursor-pointer border-b border-border hover:bg-bg-muted ${sel === m.codmotivo ? 'bg-bg-muted' : ''} ${m.indr === 'E' ? 'text-fg-muted line-through' : ''}`} onClick={() => { if (m.indr !== 'E') { setSel(m.codmotivo); setDescricao(m.descricao); } }}>
              <td className="p-pad-xs tabular-nums">{m.codmotivo}</td><td className="p-pad-xs">{m.descricao}</td>
              <td className="p-pad-xs text-right tabular-nums">{m.ajustes}</td><td className="p-pad-xs">{m.indr === 'E' ? 'excluído' : 'ativo'}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
