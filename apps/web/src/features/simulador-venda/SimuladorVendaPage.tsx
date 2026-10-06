import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { hojeNaLoja } from '../../shared/tempo';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';

/**
 * SIMULADOR DE VENDAS (`FRMSIMULADORVENDA`). Dossiê: `uSimuladorVenda.md`.
 *
 * O que foi vendido no período, produto a produto, numa grade em que se edita a venda, o custo, a quantidade, o desconto e o acréscimo
 * — com as contas das validações do `cdsVendas` do legado (sem arredondar): mexer na quantidade ou no custo refaz o total do custo e o
 * da venda; na venda, no desconto ou no acréscimo, o da venda; o lucro é sempre venda − custo. O "Consolidado" é o que veio do banco; o
 * "Simulado" acompanha a grade. "Localizar" posiciona na primeira descrição que começa com o texto (não filtra); o título da coluna
 * ordena; o Imprimir sai com a grade como está.
 * ⚠️ o "Lucro %" é **markup sobre o custo** (`(venda/custo − 1) × 100`), como no legado — não margem.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
// o GetText do udmSimuladorVenda: FormatFloat('0.00') (sem milhar); a QTDE em '0.000'
const fmt = (v: unknown, d = 2) => (v == null || v === '' ? '' : Number(v).toFixed(d).replace('.', ','));
const hoje = () => hojeNaLoja();
const diaUm = () => `${hoje().slice(0, 8)}01`;

interface Linha {
  codproduto: number | null; descricao: string | null; codbarra: string | null;
  vrvenda: number; vrcusto: number; qtde: number; desconto: number; acrescimo: number;
  total_custo: number; total_venda: number; sub_total_venda: number; lucro_total: number;
}
type Editavel = 'vrvenda' | 'vrcusto' | 'qtde' | 'desconto' | 'acrescimo';
interface Totais { subtotal: number; venda: number; acrescimo: number; desconto: number; custo: number; lucro: number; lucroPerc: number }

/** o SetaTotais: os agregados do cdsVendas */
const totaisDe = (ls: Linha[]): Totais => {
  const s = (k: keyof Linha) => ls.reduce((a, l) => a + Number(l[k] ?? 0), 0);
  const venda = s('total_venda'), custo = s('total_custo');
  return { subtotal: s('sub_total_venda'), venda, acrescimo: s('acrescimo'), desconto: s('desconto'), custo, lucro: venda - custo,
    lucroPerc: venda !== 0 && custo !== 0 ? ((venda / custo) - 1) * 100 : 0 };
};

/** os OnValidate do cdsVendas */
const aplicar = (l: Linha, campo: Editavel, valor: number): Linha => {
  const n = { ...l, [campo]: valor };
  if (campo === 'qtde' || campo === 'vrcusto') n.total_custo = n.vrcusto * n.qtde;
  n.total_venda = (n.vrvenda * n.qtde) + n.acrescimo - n.desconto;
  n.lucro_total = n.total_venda - n.total_custo;
  return n;
};

const COLUNAS: Array<{ campo: keyof Linha; titulo: string; editavel?: boolean; casas?: number; prata?: boolean; texto?: boolean }> = [
  { campo: 'codbarra', titulo: 'Cód. barra', texto: true }, { campo: 'descricao', titulo: 'Descrição', texto: true },
  { campo: 'vrvenda', titulo: 'Venda', editavel: true }, { campo: 'vrcusto', titulo: 'Custo', editavel: true },
  { campo: 'qtde', titulo: 'Qtde', editavel: true, casas: 3 }, { campo: 'desconto', titulo: 'Desconto', editavel: true },
  { campo: 'acrescimo', titulo: 'Acréscimo', editavel: true }, { campo: 'total_custo', titulo: 'Total custo', prata: true },
  { campo: 'total_venda', titulo: 'Total venda', prata: true }, { campo: 'lucro_total', titulo: 'Lucro total', prata: true },
];

export function SimuladorVendaPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: diaUm(), dataFim: hoje(), localizar: '' });
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [consolidado, setConsolidado] = useState<Totais | null>(null);
  const [ordem, setOrdem] = useState<{ campo: keyof Linha; desc: boolean } | null>(null);
  const [atual, setAtual] = useState<number | null>(null);
  const [edicao, setEdicao] = useState<{ i: number; campo: Editavel; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const corpo = useRef<HTMLTableSectionElement>(null);

  const consultar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim });
      const r = await fetch(`${BASE}/relatorios/simulador-venda?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      const j = (await r.json()) as { linhas: Linha[]; totais: Totais };
      setLinhas(j.linhas); setConsolidado(j.totais); setOrdem(null); setAtual(j.linhas.length ? 0 : null); setEdicao(null);
    } catch (e) { setLinhas(null); setConsolidado(null); mensagem.erro(e); } finally { setOcupado(false); }
  };

  // a grade na ordem da coluna clicada (o OrdenaDataSet do legado: clicar de novo inverte)
  const visiveis = useMemo(() => {
    if (!linhas) return [];
    const idx = linhas.map((_, i) => i);
    if (!ordem) return idx;
    const cmp = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? '')));
    return idx.sort((a, b) => (ordem.desc ? -1 : 1) * cmp(linhas[a][ordem.campo], linhas[b][ordem.campo]));
  }, [linhas, ordem]);
  const simulado = useMemo(() => (linhas ? totaisDe(linhas) : null), [linhas]);

  // Localizar: a primeira descrição que começa com o texto (Locate com loPartialKey), na ordem da grade
  useEffect(() => {
    if (!linhas || !f.localizar) return;
    const pos = visiveis.findIndex((i) => String(linhas[i].descricao ?? '').startsWith(f.localizar));
    if (pos >= 0) {
      setAtual(visiveis[pos]);
      corpo.current?.querySelector(`[data-linha="${visiveis[pos]}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.localizar]);

  const confirmar = () => {
    if (!edicao || !linhas) return;
    const v = Number(edicao.texto.replace(/\./g, '').replace(',', '.'));
    if (edicao.texto.trim() !== '' && Number.isFinite(v)) {
      setLinhas(linhas.map((l, i) => (i === edicao.i ? aplicar(l, edicao.campo, v) : l)));
    }
    setEdicao(null);
  };

  const imprimir = () => {
    if (!linhas?.length) { mensagem.erro('Não foram encontradas vendas no período informado.'); return; }
    void imprimirRelatorio('/relatorios/simulador-venda/impressao', { linhas: visiveis.map((i) => linhas[i]) }).catch((e) => mensagem.erro(e));
  };

  const bloco = (titulo: string, t: Totais | null, itens: Array<[string, keyof Totais, boolean?]>) => t && (
    <div className="rounded-radius-sm border border-border px-pad-sm py-pad-xs">
      <div className="mb-1 text-body-sm font-semibold">{titulo}</div>
      <div className="flex flex-wrap gap-gp-md">
        {itens.map(([r, k, perc]) => (
          <div key={k}><div className="text-body-sm text-fg-muted">{r}</div><div className="tabular-nums">{fmt(t[k])}{perc ? '%' : ''}</div></div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Simulador de vendas" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <Button label="&Localizar vendas" disabled={ocupado} onClick={() => void consultar()} />
          <Button label="&Imprimir" variant="soft" disabled={ocupado} onClick={imprimir} />
        </div>
      </section>

      {linhas && (
        <>
          <section className="flex flex-wrap gap-gp-md rounded-radius-md border border-border bg-bg-surface p-pad-md">
            {bloco('Consolidado', consolidado && { ...consolidado, lucroPerc: consolidado.custo > 0 ? ((consolidado.venda / consolidado.custo) - 1) * 100 : 0 }, [
              ['Subtotal', 'subtotal'], ['Desconto', 'desconto'], ['Acréscimo', 'acrescimo'], ['Venda', 'venda'], ['Custo total', 'custo'], ['Lucro', 'lucro'], ['Lucro %', 'lucroPerc', true],
            ])}
            {bloco('Simulado', simulado, [
              ['Venda', 'venda'], ['Custo', 'custo'], ['Lucro', 'lucro'], ['Lucro %', 'lucroPerc', true], ['Acréscimo', 'acrescimo'], ['Desconto', 'desconto'],
            ])}
          </section>

          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="mb-form-gap w-80"><Field label="Desc&rição (localizar)" value={f.localizar} onChange={(e) => setF({ ...f, localizar: e.target.value })} /></div>
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full min-w-[1100px] border-collapse text-body-sm">
                <thead className="sticky top-0 bg-bg-surface">
                  <tr className="border-b border-border text-left text-fg-muted">
                    {COLUNAS.map((c) => (
                      <th key={c.campo} className={`cursor-pointer select-none p-pad-xs ${c.texto ? '' : 'text-right'}`}
                        onClick={() => setOrdem(ordem?.campo === c.campo ? { campo: c.campo, desc: !ordem.desc } : { campo: c.campo, desc: false })}>
                        {c.titulo}{ordem?.campo === c.campo ? (ordem.desc ? ' ▼' : ' ▲') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody ref={corpo}>
                  {visiveis.map((i) => {
                    const l = linhas[i];
                    return (
                      <tr key={i} data-linha={i} onClick={() => setAtual(i)} className={`border-b border-border ${atual === i ? 'bg-bg-subtle' : ''}`}>
                        {COLUNAS.map((c) => {
                          if (c.texto) return <td key={c.campo} className={`p-pad-xs ${c.campo === 'codbarra' ? 'font-mono' : ''}`}>{String(l[c.campo] ?? '')}</td>;
                          const emEdicao = edicao && edicao.i === i && edicao.campo === c.campo;
                          if (emEdicao) {
                            return (
                              <td key={c.campo} className="p-0">
                                <input autoFocus aria-label={`${c.titulo} de ${l.descricao ?? ''}`} className="h-8 w-full rounded-radius-sm border border-border bg-bg-base px-pad-xs text-right tabular-nums"
                                  value={edicao.texto} onChange={(e) => setEdicao({ ...edicao, texto: e.target.value })}
                                  onBlur={confirmar} onKeyDown={(e) => { if (e.key === 'Enter') confirmar(); if (e.key === 'Escape') setEdicao(null); }} />
                              </td>
                            );
                          }
                          return (
                            <td key={c.campo}
                              className={`p-pad-xs text-right tabular-nums ${c.prata ? 'bg-bg-subtle' : ''} ${c.editavel ? 'cursor-text' : ''}`}
                              onClick={c.editavel ? () => setEdicao({ i, campo: c.campo as Editavel, texto: fmt(l[c.campo], c.casas ?? 2) }) : undefined}>
                              {fmt(l[c.campo], c.casas ?? 2)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
