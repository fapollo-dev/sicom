import { useCallback, useEffect, useState } from 'react';
import { Modal, PageHeader } from '@apollosg/design-system';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { DATAS_FATURAMENTO, isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';
import { hojeNaLoja } from '../../shared/tempo';

/**
 * FATURAMENTO DA NOTA (`FRMFATURAMENTO2`).
 * Dossiê: `uFaturamento2.md`.
 *
 * As parcelas de cada nota: quando vencem, quanto, e se já viraram título. A legenda de três estados do
 * original — **vencendo hoje**, **atrasada**, **faturada** — está nas cores da tabela.
 * Operacional (corte B): marca as parcelas pendentes (clique; "marcar todas"), **Processar (F2)** abre o pré-lançamento
 * da tela de Contas a Pagar / Receber para ajustar e gravar os títulos, **Bonificar (F4)** libera a parcela sem título.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => hojeNaLoja();
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

interface Linha {
  codfaturamento: number; idnf: number; nronf: string | null; serie: string | null; tipo: string;
  titular: string; totalnf: number | null; dtemissao: string | null; vencimento: string | null;
  valor: number; liberado: string; modalidade: string | null; nrofatura: number | null;
  totalparcelasfatura: number | null; duplicata: string | null; codbarrasboleto: string | null;
  situacao: string; data_invalida: boolean;
}
interface Resultado {
  linhas: Linha[];
  totais: { parcelas: number; notas: number; valor: number; vencendoHoje: number; atrasadas: number; faturadas: number; dataInvalida: number };
}

const COR: Record<string, string> = {
  VENCE_HOJE: 'text-fg-warning font-semibold',
  ATRASADA: 'text-fg-danger font-semibold',
  FATURADA: 'text-fg-muted',
};
const ROTULO: Record<string, string> = {
  VENCE_HOJE: 'Vence hoje', ATRASADA: 'Atrasada', FATURADA: 'Faturada',
  A_VENCER: 'A vencer', SEM_VENCIMENTO: 'Sem vencimento',
};

interface Titulo {
  codfaturamento: number; valor: number; dtvenc: string; tipodoc: string; duplicata?: string | null; nrparcela?: string;
  codbarrasblt?: string | null; idpgto?: number | null; desconto?: number;
}
interface NotaPrevia { codnf: number; nronf: string | null; tipo: string; titular: string | null; tabela: 'apagar' | 'areceber'; titulos: Titulo[] }
const TIPOS_DOC = ['BOLETO', 'CARTÃO PRÓPRIO', 'A VISTA', 'DEPÓSITO', 'TRANSFERÊNCIA'];

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}/${path}`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
  handle401(r);
  const b = await r.json().catch(() => ({}));
  if (!r.ok) {
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
    throw Object.assign(new Error(env.code), { envelope: env, body: b });
  }
  return b as T;
}

export function FaturamentoPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: diaUm(), dataFim: hoje(), base: 'PARCELA', tipo: 'E', liberado: 'N',
    nronf: '', codparceiro: '',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [previa, setPrevia] = useState<NotaPrevia[] | null>(null);
  const { data: formaOptions = [] } = useResourceOptions('cadastro/formas-pgto',
    (x: any) => ({ value: String(x.idpgto), label: `${x.idpgto} - ${x.modalidade ?? ''}` }));

  const buscar = useCallback(async (filtro = f) => {
    setOcupado(true);
    setSel(new Set());
    try {
      const q = new URLSearchParams({ dataIni: filtro.dataIni, dataFim: filtro.dataFim, base: filtro.base, tipo: filtro.tipo, liberado: filtro.liberado });
      if (filtro.nronf) q.set('nronf', filtro.nronf);
      if (filtro.codparceiro) q.set('codparceiro', filtro.codparceiro);
      const r = await fetch(`${BASE}/compras/faturamento?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  }, [f, mensagem]);

  // o botão "Faturamento" da nota abre aqui com o filtro pronto (emissão, número, lado) e busca (uNF.pas:4350-4366)
  useEffect(() => {
    let pend: { tipo?: string; nronf?: string; dataIni?: string; dataFim?: string } | null = null;
    try { pend = JSON.parse(sessionStorage.getItem('apollo.faturamento.nota') ?? 'null'); sessionStorage.removeItem('apollo.faturamento.nota'); } catch { pend = null; }
    if (!pend) return;
    const filtro = { ...f, base: 'EMISSAO', liberado: 'N', tipo: pend.tipo ?? 'E', nronf: pend.nronf ?? '', dataIni: pend.dataIni ?? f.dataIni, dataFim: pend.dataFim ?? f.dataFim };
    setF(filtro);
    void buscar(filtro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const marcar = (l: Linha) => {
    if (l.liberado === 'S') return; // a parcela liberada não marca (MarcarDocumento, uFaturamento2.pas:702)
    setSel((s0) => { const s1 = new Set(s0); if (s1.has(l.codfaturamento)) s1.delete(l.codfaturamento); else s1.add(l.codfaturamento); return s1; });
  };
  const pendentes = (res?.linhas ?? []).filter((l) => l.liberado !== 'S');
  const todasMarcadas = pendentes.length > 0 && pendentes.every((l) => sel.has(l.codfaturamento));
  const marcarTodas = () => setSel(todasMarcadas ? new Set() : new Set(pendentes.map((l) => l.codfaturamento)));

  const abrirProcessar = async () => {
    if (!sel.size) { mensagem.erro(Object.assign(new Error('FATURAMENTO_SEM_PARCELA'), { envelope: { statusCode: 400, code: 'FATURAMENTO_SEM_PARCELA', message: 'Selecione ao menos uma parcela.' } })); return; }
    try { setPrevia(await postJson<NotaPrevia[]>('compras/faturamento/previa', { codfaturamento: [...sel] })); } catch (e) { mensagem.erro(e); }
  };
  const editarTitulo = (ni: number, ti: number, campo: keyof Titulo, v: unknown) =>
    setPrevia((p) => p && p.map((n, i) => (i !== ni ? n : { ...n, titulos: n.titulos.map((t, j) => (j !== ti ? t : { ...t, [campo]: v })) })));
  const gravar = async (confirmarRepetida = false): Promise<void> => {
    if (!previa) return;
    const ajustes = previa.flatMap((n) => n.titulos.map((t) => ({
      codfaturamento: t.codfaturamento, dtvenc: t.dtvenc, valor: Number(String(t.valor).replace(',', '.')), tipodoc: t.tipodoc,
      ...(n.tabela === 'apagar' ? { codbarrasblt: t.codbarrasblt ?? null } : t.idpgto ? { idpgto: Number(t.idpgto) } : {}),
    })));
    try {
      const r = await postJson<{ notas: Array<{ titulos: number[] }> }>('compras/faturamento/processar', { codfaturamento: previa.flatMap((n) => n.titulos.map((t) => t.codfaturamento)), ajustes, confirmarRepetida });
      mensagem.sucesso(`${r.notas.reduce((s0, n) => s0 + n.titulos.length, 0)} título(s) gerado(s).`);
      setPrevia(null);
      await buscar();
    } catch (e) {
      const env = (e as { envelope?: { code?: string; detalhe?: { codapg?: number } } }).envelope;
      if (env?.code === 'FATURAMENTO_CONTA_REPETIDA'
        && window.confirm(`O sistema identificou que esta conta pode ter sido lançada anteriormente (conta ${env.detalhe?.codapg ?? ''}).\nDeseja continuar?`)) {
        return gravar(true);
      }
      mensagem.erro(e);
    }
  };
  const bonificar = async () => {
    if (!sel.size) return;
    try {
      await postJson('compras/faturamento/bonificar', { codfaturamento: [...sel] });
      mensagem.sucesso('Parcela(s) bonificada(s).');
      await buscar();
    } catch (e) { mensagem.erro(e); }
  };
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      if (previa) return;
      if (ev.key === 'F2') { ev.preventDefault(); void abrirProcessar(); }
      if (ev.key === 'F4') { ev.preventDefault(); void bonificar(); }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Faturamento da nota" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          As parcelas de cada nota: quando vencem, quanto, e se já viraram título no financeiro. Só nota
          <strong> processada</strong> aparece, como no original.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Filtrar por
            <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
              value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })}>
              {DATAS_FATURAMENTO.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Lado
            <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
              value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              <option value="E">A pagar (nota de entrada)</option><option value="S">A receber (nota de saída)</option>
            </select>
          </label>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Situação
            <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
              value={f.liberado} onChange={(e) => setF({ ...f, liberado: e.target.value })}>
              <option value="N">A faturar</option><option value="S">Já faturadas</option><option value="TODOS">Todas</option>
            </select>
          </label>
          <div className="w-32"><Field label="&Nota fiscal" value={f.nronf} onChange={(e) => setF({ ...f, nronf: e.target.value })} /></div>
          <div className="w-32"><Field label="&Parceiro" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value })} /></div>
          <Button label="&Consultar" disabled={ocupado} onClick={() => void buscar()} />
          <Button label="&Processar (F2)" disabled={ocupado || !sel.size} onClick={() => void abrirProcessar()} />
          <Button variant="outline" label="&Bonificar (F4)" disabled={ocupado || !sel.size} onClick={() => void bonificar()} />
          {res && (
            <Button variant="outline" label="&Exportar" onClick={() => exportarGradeCsv(
              res.linhas,
              [
                { titulo: 'NF', valor: (l: Linha) => l.nronf },
                { titulo: 'Série', valor: (l: Linha) => l.serie },
                { titulo: 'Titular', valor: (l: Linha) => l.titular },
                { titulo: 'Emissão', valor: (l: Linha) => dataBr(l.dtemissao) },
                { titulo: 'Vencimento', valor: (l: Linha) => dataBr(l.vencimento) },
                { titulo: 'Parcela', valor: (l: Linha) => `${l.nrofatura ?? ''}/${l.totalparcelasfatura ?? ''}` },
                { titulo: 'Valor', valor: (l: Linha) => moeda(l.valor) },
                { titulo: 'Modalidade', valor: (l: Linha) => l.modalidade },
                { titulo: 'Situação', valor: (l: Linha) => ROTULO[l.situacao] ?? l.situacao },
                { titulo: 'Duplicata', valor: (l: Linha) => l.duplicata },
              ],
              'faturamento',
            )} />
          )}
        </div>
      </section>

      {res && (
        <section className="flex flex-wrap gap-gp-lg rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div><div className="text-body-sm text-fg-muted">Parcelas</div><div className="text-title-sm tabular-nums">{res.totais.parcelas}</div></div>
          <div><div className="text-body-sm text-fg-muted">Notas</div><div className="text-title-sm tabular-nums">{res.totais.notas}</div></div>
          <div><div className="text-body-sm text-fg-muted">Valor</div><div className="text-title-sm tabular-nums">{moeda(res.totais.valor)}</div></div>
          <div><div className="text-body-sm text-fg-muted">Vencendo hoje</div><div className="text-title-sm tabular-nums text-fg-warning">{res.totais.vencendoHoje}</div></div>
          <div><div className="text-body-sm text-fg-muted">Atrasadas</div><div className="text-title-sm tabular-nums text-fg-danger">{res.totais.atrasadas}</div></div>
          <div><div className="text-body-sm text-fg-muted">Faturadas</div><div className="text-title-sm tabular-nums">{res.totais.faturadas}</div></div>
          {res.totais.dataInvalida > 0 && (
            <div>
              <div className="text-body-sm text-fg-muted">Data suspeita</div>
              <div className="text-title-sm tabular-nums text-fg-danger">{res.totais.dataInvalida}</div>
            </div>
          )}
        </section>
      )}

      {res && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full min-w-[1000px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs"><input type="checkbox" aria-label="Marcar todas" checked={todasMarcadas} onChange={marcarTodas} /></th>
                <th className="p-pad-xs">NF</th><th className="p-pad-xs">Titular</th>
                <th className="p-pad-xs">Emissão</th><th className="p-pad-xs">Vencimento</th>
                <th className="p-pad-xs">Parcela</th><th className="p-pad-xs">Valor</th>
                <th className="p-pad-xs">Modalidade</th><th className="p-pad-xs">Duplicata</th>
                <th className="p-pad-xs">Situação</th>
              </tr>
            </thead>
            <tbody>
              {res.linhas.map((l) => (
                <tr key={l.codfaturamento} className={`border-b border-border ${sel.has(l.codfaturamento) ? 'bg-bg-subtle' : ''}`} onClick={() => marcar(l)}>
                  <td className="p-pad-xs">{l.liberado !== 'S' && <input type="checkbox" aria-label="Marcar parcela" checked={sel.has(l.codfaturamento)} onChange={() => marcar(l)} onClick={(e) => e.stopPropagation()} />}</td>
                  <td className="p-pad-xs">{l.nronf}{l.serie ? `/${l.serie}` : ''}</td>
                  <td className="p-pad-xs">{l.titular}</td>
                  <td className="p-pad-xs">{dataBr(l.dtemissao)}</td>
                  <td className={`p-pad-xs ${l.data_invalida ? 'text-fg-danger' : ''}`}>
                    {dataBr(l.vencimento)}{l.data_invalida ? ' ⚠' : ''}
                  </td>
                  <td className="p-pad-xs tabular-nums">{l.nrofatura ?? ''}/{l.totalparcelasfatura ?? ''}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.valor)}</td>
                  <td className="p-pad-xs">{l.modalidade}</td>
                  <td className="p-pad-xs">{l.duplicata}</td>
                  <td className={`p-pad-xs ${COR[l.situacao] ?? ''}`}>{ROTULO[l.situacao] ?? l.situacao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previa && (
        <Modal open onClose={() => setPrevia(null)} size="lg" title="Processar faturamento — pré-lançamento"
          primaryAction={{ label: 'Gravar títulos', onClick: () => void gravar() }} secondaryAction={{ label: 'Cancelar', onClick: () => setPrevia(null) }}>
          <div className="flex flex-col gap-gp-md">
            {previa.map((n, ni) => (
              <div key={n.codnf} className="flex flex-col gap-gp-xs">
                <strong className="text-body-sm">NF {n.nronf ?? n.codnf} · {n.titular ?? ''} · {n.tabela === 'apagar' ? 'Contas a pagar' : 'Contas a receber'}</strong>
                <div className="overflow-x-auto">
                  <table className="w-full text-body-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-fg-muted">
                        <th className="p-pad-xs">Parcela</th><th className="p-pad-xs">Vencimento</th><th className="p-pad-xs">Valor</th>
                        <th className="p-pad-xs">Tipo de documento</th>
                        <th className="p-pad-xs">{n.tabela === 'apagar' ? 'Código de barras' : 'Forma de pagamento'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {n.titulos.map((t, ti) => (
                        <tr key={t.codfaturamento} className="border-b border-border/50">
                          <td className="p-pad-xs tabular-nums">{t.nrparcela ?? t.duplicata}</td>
                          <td className="p-pad-xs"><input type="date" className="rounded-radius-sm border border-border bg-bg-base px-1" value={t.dtvenc} onChange={(e) => editarTitulo(ni, ti, 'dtvenc', e.target.value)} /></td>
                          <td className="p-pad-xs"><input className="w-28 rounded-radius-sm border border-border bg-bg-base px-1 text-right tabular-nums" inputMode="decimal" value={t.valor} onChange={(e) => editarTitulo(ni, ti, 'valor', e.target.value)} /></td>
                          <td className="p-pad-xs">
                            <select className="rounded-radius-sm border border-border bg-bg-base px-1" value={t.tipodoc} onChange={(e) => editarTitulo(ni, ti, 'tipodoc', e.target.value)}>
                              {[...new Set([t.tipodoc, ...TIPOS_DOC])].map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </td>
                          <td className="p-pad-xs">
                            {n.tabela === 'apagar'
                              ? <input className="w-72 rounded-radius-sm border border-border bg-bg-base px-1" maxLength={48} value={t.codbarrasblt ?? ''} onChange={(e) => editarTitulo(ni, ti, 'codbarrasblt', e.target.value)} />
                              : (
                                <select className="rounded-radius-sm border border-border bg-bg-base px-1" value={t.idpgto != null ? String(t.idpgto) : ''} onChange={(e) => editarTitulo(ni, ti, 'idpgto', e.target.value ? Number(e.target.value) : null)}>
                                  <option value="">Selecione…</option>
                                  {formaOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
