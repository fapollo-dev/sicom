import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';

/**
 * ANÁLISE DE ITENS DA NOTA FISCAL (`FRMRELANALISEITENSNF`).
 * Dossiê: `uRelAnaliseItensNF.md`.
 *
 * Item a item das notas do período, com custo, base, ICMS, ST e isento.
 *
 * ⚠️ no legado o `WHERE` só filtrava a data — somava entrada com saída, de todas as lojas, inclusive notas
 * canceladas. Aqui o tipo é escolha e a loja é a da sessão.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

interface Linha {
  codnf: number; nronf: string | null; tipo: string; dtcontabil: string | null; razao: string;
  codbarra: string | null; descricao: string | null; quantidade: number | null; vrcusto: number | null;
  total_custo: number | null; vrbasecalculo: number; vricm: number; vroutrasdesp: number;
  isento: number; vrbasest: number; vricmst: number; aliquota: string | null;
}
interface Resultado {
  linhas: Linha[];
  totais: { itens: number; quantidade: number; custo: number; base: number; icms: number; st: number; isento: number; outras: number };
}

export function RelAnaliseItensNfPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: diaUm(), dataFim: hoje(), tipo: 'E', incluirCanceladas: 'N',
    codfor: '', coddpto: '', codgrupo: '', codnf: '',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim, tipo: f.tipo, incluirCanceladas: f.incluirCanceladas });
      for (const k of ['codfor', 'coddpto', 'codgrupo', 'codnf'] as const) if (f[k]) q.set(k, f[k]);
      const r = await fetch(`${BASE}/relatorios/analise-itens-nf?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Análise de itens da nota fiscal" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Item a item, com custo, base de cálculo, ICMS, ST e o que é isento — a conferência antes de fechar a
          apuração. Por padrão, só <strong>entradas não canceladas</strong>.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Tipo de nota
            <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
              value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              <option value="E">Entrada</option><option value="S">Saída</option><option value="TODAS">Todas</option>
            </select>
          </label>
          <label className="flex items-center gap-gp-xs text-body-sm">
            <input type="checkbox" checked={f.incluirCanceladas === 'S'}
              onChange={(e) => setF({ ...f, incluirCanceladas: e.target.checked ? 'S' : 'N' })} />
            Incluir canceladas
          </label>
          <div className="w-32"><Field label="&Fornecedor" value={f.codfor} onChange={(e) => setF({ ...f, codfor: e.target.value })} /></div>
          <div className="w-32"><Field label="&Departamento" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-32"><Field label="&Grupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
          <div className="w-32"><Field label="&Nota fiscal" value={f.codnf} onChange={(e) => setF({ ...f, codnf: e.target.value })} /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void buscar()} />
          {res && (
            <Button variant="outline" label="&Exportar" onClick={() => exportarGradeCsv(
              res.linhas,
              [
                { titulo: 'NF', valor: (l: Linha) => l.nronf },
                { titulo: 'Tipo', valor: (l: Linha) => l.tipo },
                { titulo: 'Data', valor: (l: Linha) => dataBr(l.dtcontabil) },
                { titulo: 'Parceiro', valor: (l: Linha) => l.razao },
                { titulo: 'EAN', valor: (l: Linha) => l.codbarra },
                { titulo: 'Produto', valor: (l: Linha) => l.descricao },
                { titulo: 'Qtde', valor: (l: Linha) => nfmt(l.quantidade) },
                { titulo: 'Custo unit.', valor: (l: Linha) => moeda(l.vrcusto) },
                { titulo: 'Total', valor: (l: Linha) => moeda(l.total_custo) },
                { titulo: 'Base ICMS', valor: (l: Linha) => moeda(l.vrbasecalculo) },
                { titulo: 'ICMS', valor: (l: Linha) => moeda(l.vricm) },
                { titulo: 'Base ST', valor: (l: Linha) => moeda(l.vrbasest) },
                { titulo: 'ICMS ST', valor: (l: Linha) => moeda(l.vricmst) },
                { titulo: 'Isento', valor: (l: Linha) => moeda(l.isento) },
                { titulo: 'Alíquota', valor: (l: Linha) => l.aliquota },
              ],
              'analise-itens-nf',
            )} />
          )}
        </div>
      </section>

      {res && (
        <section className="flex flex-wrap gap-gp-lg rounded-radius-md border border-border bg-bg-surface p-pad-md">
          {[['Itens', String(res.totais.itens)], ['Quantidade', nfmt(res.totais.quantidade)],
            ['Custo total', moeda(res.totais.custo)], ['Base ICMS', moeda(res.totais.base)],
            ['ICMS', moeda(res.totais.icms)], ['ICMS ST', moeda(res.totais.st)],
            ['Isento', moeda(res.totais.isento)], ['Outras desp.', moeda(res.totais.outras)]].map(([r, v]) => (
            <div key={String(r)}>
              <div className="text-body-sm text-fg-muted">{r}</div>
              <div className="text-title-sm tabular-nums">{v}</div>
            </div>
          ))}
        </section>
      )}

      {res && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full min-w-[1200px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">NF</th><th className="p-pad-xs">Data</th>
                <th className="p-pad-xs">Parceiro</th><th className="p-pad-xs">Produto</th>
                <th className="p-pad-xs">Qtde</th><th className="p-pad-xs">Custo un.</th>
                <th className="p-pad-xs">Total</th><th className="p-pad-xs">Base ICMS</th>
                <th className="p-pad-xs">ICMS</th><th className="p-pad-xs">Base ST</th>
                <th className="p-pad-xs">ICMS ST</th><th className="p-pad-xs">Isento</th>
                <th className="p-pad-xs">Alíq.</th>
              </tr>
            </thead>
            <tbody>
              {res.linhas.map((l, i) => (
                <tr key={`${l.codnf}-${i}`} className="border-b border-border">
                  <td className="p-pad-xs">{l.nronf}{l.tipo === 'S' ? ' (saída)' : ''}</td>
                  <td className="p-pad-xs">{dataBr(l.dtcontabil)}</td>
                  <td className="p-pad-xs">{l.razao}</td>
                  <td className="p-pad-xs">{l.descricao}</td>
                  <td className="p-pad-xs tabular-nums">{nfmt(l.quantidade)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.vrcusto)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.total_custo)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.vrbasecalculo)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.vricm)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.vrbasest)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.vricmst)}</td>
                  <td className="p-pad-xs tabular-nums">{moeda(l.isento)}</td>
                  <td className="p-pad-xs">{l.aliquota}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
