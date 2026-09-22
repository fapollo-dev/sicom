import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, OPERACOES_CLUBE, OPERACOES_SEM_BARRAS, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * CLUBE DE DESCONTO — o cadastro das regras (mig 285). Dossiê `uClubeDesconto.md`.
 *
 * ⚠️ O campo `valor` muda de unidade conforme a operação: em PRECO ele é o preço em reais, em VARIAVEL é
 * desconto (percentual ou reais, conforme o tipo). A tela mostra o rótulo certo e a prévia do preço do
 * clube, porque ler o par `valor`/`tipo` errado é o defeito mais caro deste cadastro.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Regra = {
  idclubedesconto: number; operacao: string; barras: string | null; produto: string | null;
  descricao: string | null; valor: number | null; tipo: string | null; quantidade: number | null;
  quantidade_paga: number | null; maximo: number | null; pdv: number | null;
  codigo_promocional: string | null; data_inicio: string; data_fim: string;
  ativo: string; encerrada: string; indr: string | null;
  preco_normal: number | null; preco_clube: number | null; unidade_valor: string;
};

const brl = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dia = (d: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const vazio = () => ({
  operacao: 'PRECO', barras: '', descricao: '', valor: '', tipo: '', quantidade: '1',
  quantidade_paga: '', maximo: '', pdv: '', codigo_promocional: '',
  data_inicio: new Date().toISOString().slice(0, 10), data_fim: new Date().toISOString().slice(0, 10),
});

/** como o valor daquela operação deve ser lido — é o que evita 419% de desconto */
const rotuloValor = (operacao: string, tipo: string) =>
  operacao === 'PRECO' ? '&Preço do clube (R$)'
    : tipo === '%' ? '&Desconto (%)' : tipo === '$' ? '&Desconto (R$)' : '&Valor';

export function ClubeDescontoPage() {
  const mensagem = useMensagem();
  const [q, setQ] = useState('');
  const [operacao, setOperacao] = useState('');
  const [vigentes, setVigentes] = useState(true);
  const [itens, setItens] = useState<Regra[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [f, setF] = useState<Record<string, string>>(vazio());
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

  const buscar = async () => {
    try {
      const p = new URLSearchParams({ q: q.trim(), limite: '300' });
      if (operacao) p.set('operacao', operacao);
      if (vigentes) p.set('vigentes', 'true');
      const r = await pedir<{ itens: Regra[] }>(`${BASE}/precificacao/clube-desconto?${p}`);
      setItens(r.itens);
    } catch (e) { mensagem.erro(e); }
  };
  useEffect(() => { void buscar(); }, []);

  const novo = () => { setSel(null); setF(vazio()); };
  const editar = (r: Regra) => {
    setSel(r.idclubedesconto);
    setF({
      operacao: r.operacao, barras: r.barras ?? '', descricao: r.descricao ?? '',
      valor: r.valor == null ? '' : String(r.valor), tipo: r.tipo ?? '',
      quantidade: r.quantidade == null ? '' : String(r.quantidade),
      quantidade_paga: r.quantidade_paga == null ? '' : String(r.quantidade_paga),
      maximo: r.maximo == null ? '' : String(r.maximo),
      pdv: r.pdv == null ? '' : String(r.pdv), codigo_promocional: r.codigo_promocional ?? '',
      data_inicio: String(r.data_inicio).slice(0, 10), data_fim: String(r.data_fim).slice(0, 10),
    });
  };

  const gravar = async () => {
    setOcupado(true);
    try {
      const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
      const corpo = {
        operacao: f.operacao, loja: 1, ativo: 'S', encerrada: 'F', origem: 'S',
        barras: f.barras.trim() || null, descricao: f.descricao.trim() || null,
        valor: n(f.valor), tipo: f.tipo || null, quantidade: n(f.quantidade),
        quantidade_paga: n(f.quantidade_paga), maximo: n(f.maximo), pdv: n(f.pdv),
        codigo_promocional: f.codigo_promocional.trim() || null,
        data_inicio: `${f.data_inicio}T00:00:00-03:00`, data_fim: `${f.data_fim}T23:59:00-03:00`,
      };
      await pedir(`${BASE}/precificacao/clube-desconto${sel ? `/${sel}` : ''}`, {
        method: sel ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      mensagem.sucesso('Regra gravada.'); novo(); await buscar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const excluir = async () => {
    if (!sel || !window.confirm('Excluir esta regra do clube?')) return;
    try {
      await pedir(`${BASE}/precificacao/clube-desconto/${sel}`, { method: 'DELETE' });
      mensagem.sucesso('Regra excluída.'); novo(); await buscar();
    } catch (e) { mensagem.erro(e); }
  };

  const semBarras = OPERACOES_SEM_BARRAS.includes(f.operacao);
  const ehPreco = f.operacao === 'PRECO';

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Clube de desconto" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          As regras de preço e desconto do clube. <strong>O campo do valor muda de significado conforme a
          operação</strong>: em preço de clube ele é o preço em reais; nas demais é desconto, em percentual
          ou em reais. O rótulo abaixo acompanha a operação escolhida.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-52">
            <label className="mb-1 block text-body-sm text-fg-muted">&Operação</label>
            <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm"
              value={f.operacao} onChange={(e) => setF({ ...f, operacao: e.target.value, tipo: e.target.value === 'PRECO' ? '' : f.tipo })}>
              {OPERACOES_CLUBE.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          {!semBarras && <div className="w-44"><Field label="Código de &barras" value={f.barras} maxLength={20} onChange={(e) => setF({ ...f, barras: e.target.value.replace(/\D/g, '') })} /></div>}
          {semBarras && <span className="pb-2 text-body-sm text-fg-muted">esta operação desconta o cupom inteiro, sem produto</span>}
          <div className="w-36"><Field label={rotuloValor(f.operacao, f.tipo)} value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></div>
          {!ehPreco && (
            <div className="w-28">
              <label className="mb-1 block text-body-sm text-fg-muted">&Tipo</label>
              <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm"
                value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
                <option value="">—</option><option value="%">%</option><option value="$">R$</option>
              </select>
            </div>
          )}
          <div className="w-28"><Field label="&Quantidade" value={f.quantidade} onChange={(e) => setF({ ...f, quantidade: e.target.value })} /></div>
          <div className="w-28"><Field label="Qtde. &paga" value={f.quantidade_paga} onChange={(e) => setF({ ...f, quantidade_paga: e.target.value })} /></div>
          <div className="w-28"><Field label="&Máximo" value={f.maximo} onChange={(e) => setF({ ...f, maximo: e.target.value })} /></div>
          {f.operacao === 'DESCONTO_POR_PDV' && <div className="w-24"><Field label="P&DV" value={f.pdv} onChange={(e) => setF({ ...f, pdv: e.target.value.replace(/\D/g, '') })} /></div>}
          {f.operacao === 'CODIGO_PROMOCIONAL' && <div className="w-44"><Field label="&Código" value={f.codigo_promocional} onChange={(e) => setF({ ...f, codigo_promocional: e.target.value })} /></div>}
          <div className="w-40"><Field label="&Início" type="date" value={f.data_inicio} onChange={(e) => setF({ ...f, data_inicio: e.target.value })} /></div>
          <div className="w-40"><Field label="&Fim" type="date" value={f.data_fim} onChange={(e) => setF({ ...f, data_fim: e.target.value })} /></div>
          <div className="w-[22rem]"><Field label="Descriçã&o" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
          <Button label={sel ? '&Gravar' : '&Incluir'} disabled={ocupado} onClick={() => void gravar()} />
          <Button label="No&vo" variant="outline" onClick={novo} />
          {sel && <Button label="E&xcluir" variant="ghost" onClick={() => void excluir()} />}
        </div>
      </section>

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-64"><Field label="&Buscar (barras, produto ou descrição)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }} /></div>
          <div className="w-48">
            <label className="mb-1 block text-body-sm text-fg-muted">Filtrar operação</label>
            <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm"
              value={operacao} onChange={(e) => setOperacao(e.target.value)}>
              <option value="">todas</option>
              {OPERACOES_CLUBE.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-gp-xs pb-2 text-body-sm">
            <input type="checkbox" checked={vigentes} onChange={(e) => setVigentes(e.target.checked)} /> só as que valem agora
          </label>
          <Button label="&Pesquisar" onClick={() => void buscar()} />
          <span className="text-body-sm text-fg-muted">{itens.length} regra(s)</span>
        </div>
        <div className="mt-form-gap overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse text-body-sm">
            <thead><tr className="border-b border-border text-left text-fg-muted">
              <th className="p-pad-xs">Operação</th><th className="p-pad-xs">Produto</th>
              <th className="p-pad-xs text-right">Valor</th><th className="p-pad-xs">Unidade</th>
              <th className="p-pad-xs text-right">Preço normal</th><th className="p-pad-xs text-right">Preço clube</th>
              <th className="p-pad-xs text-right">Qtde</th><th className="p-pad-xs">Vigência</th>
            </tr></thead>
            <tbody>{itens.map((r) => (
              <tr key={r.idclubedesconto} className={`cursor-pointer border-b border-border hover:bg-bg-muted ${sel === r.idclubedesconto ? 'bg-bg-muted' : ''}`} onClick={() => editar(r)}>
                <td className="p-pad-xs">{r.operacao}</td>
                <td className="p-pad-xs">{r.produto ?? r.descricao ?? (r.barras ? r.barras : 'cupom inteiro')}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(r.valor)}</td>
                <td className="p-pad-xs text-fg-muted">{r.unidade_valor}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(r.preco_normal)}</td>
                <td className="p-pad-xs text-right tabular-nums font-semibold">{brl(r.preco_clube)}</td>
                <td className="p-pad-xs text-right tabular-nums">{r.quantidade ?? ''}{r.quantidade_paga != null ? ` / ${r.quantidade_paga}` : ''}</td>
                <td className="p-pad-xs text-fg-muted">{dia(r.data_inicio)} a {dia(r.data_fim)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
