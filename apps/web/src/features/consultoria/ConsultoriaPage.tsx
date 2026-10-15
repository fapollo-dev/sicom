import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { LookupField } from '../../shared/ui/LookupField';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { hojeNaLoja } from '../../shared/tempo';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(r);
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: (b as { message?: string })?.message ?? r.statusText };
    throw Object.assign(new Error(env.code), { envelope: env });
  }
  return (await r.json()) as T;
}

type Linha = Record<string, unknown>;
interface Resultado { tipo: 'PARTICIPACAO' | 'RANKING' | 'NENHUM'; linhas?: Linha[]; percPerda?: number; geral?: number }
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: unknown) => `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const sel = 'w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm';
// o frmFiltro do legado (SetaFiltro): '=', ' %' (começa), '% ' (termina), '%%' (contém), '<>'
const FILTROS = [['igual', 'Igual a'], ['comeca', 'Começa com'], ['termina', 'Termina com'], ['contem', 'Contém'], ['diferente', 'Diferente de']] as const;

/**
 * CONSULTORIA APOLLO (`FRMCONSULTORIAATM`, uConsultoriaATM.pas/.dfm). Dossiê: `uConsultoriaATM.md`. O "Tipo Consulta" (Vendas / Vendas e
 * Notas Fiscais), o `CmbRelatorio` com os layouts `at&m_*` (os da RELATORIOS), o período e as lojas; o centro de custo só no
 * "participacao dos setores" (a Pesquisa da GET_PLC: contas no tamanho da máscara, de DESPESA) e o fornecedor só no "ranking geral por
 * familias" (maiúsculas, com o filtro do frmFiltro) — o `CmbRelatorioChange` limpa os dois a cada troca. "Gerar" mostra os dados do
 * layout; "Imprimir" sai no layout do cliente.
 */
export function ConsultoriaPage() {
  const mensagem = useMensagem();
  const [layouts, setLayouts] = useState<Array<{ arquivo: string; nome: string }>>([]);
  const [arquivo, setArquivo] = useState('');
  const [tipo, setTipo] = useState<0 | 1>(0);
  const [dataIni, setDataIni] = useState(hojeNaLoja());
  const [dataFim, setDataFim] = useState(hojeNaLoja());
  const [empresas, setEmpresas] = useState('');
  const [plc, setPlc] = useState<string | undefined>();
  const [fornecedor, setFornecedor] = useState('');
  const [filtroFornecedor, setFiltroFornecedor] = useState<(typeof FILTROS)[number][0]>('contem');
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    req<Array<{ arquivo: string; nome: string }>>('/relatorios/consultoria/layouts')
      .then((ls) => { setLayouts(ls); if (ls.length) setArquivo(ls[0].arquivo); })
      .catch((e) => mensagem.erro(e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const nomeArq = arquivo.toLowerCase();
  const comPlc = nomeArq === 'at&m_participacao_dos_setores.fr3';
  const comFornecedor = nomeArq.includes('ranking_geral_por_familias');
  const trocar = (a: string) => { setArquivo(a); setPlc(undefined); setFornecedor(''); setRes(null); };
  const corpo = () => {
    const lojas = empresas.split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0);
    return {
      arquivo, tipo, dataIni, dataFim, ...(lojas.length ? { empresas: lojas } : {}),
      plc: comPlc ? plc ?? null : null,
      fornecedor: comFornecedor && fornecedor.trim() ? fornecedor.trim().toUpperCase() : null,
      filtroFornecedor: comFornecedor && fornecedor.trim() ? filtroFornecedor : null,
    };
  };
  const gerar = async () => {
    if (ocupado || !arquivo) return;
    setOcupado(true);
    try { setRes(await req<Resultado>('/relatorios/consultoria/consultar', { method: 'POST', body: JSON.stringify(corpo()) })); }
    catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const imprimir = () => { imprimirRelatorio('/relatorios/consultoria/impressao', corpo()).catch((e) => mensagem.erro(e)); };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Consultoria Apollo" />
      <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <fieldset className="flex gap-gp-md" role="radiogroup" aria-label="Tipo Consulta">
          <legend className="text-body-sm text-fg-muted">Tipo Consulta</legend>
          {(['Vendas', 'Vendas e Notas Fiscais'] as const).map((t, i) => (
            <label key={t} className="flex items-center gap-gp-xs text-body-sm">
              <input type="radio" name="cons-tipo" checked={tipo === i} onChange={() => setTipo(i as 0 | 1)} />{t}
            </label>
          ))}
        </fieldset>
        <div className="w-96">
          <label className="mb-1 block text-body-sm text-fg-muted" htmlFor="cons-relatorio">Escolha o Relatório Desejado</label>
          <select id="cons-relatorio" className={sel} value={arquivo} onChange={(e) => trocar(e.target.value)}>
            {layouts.map((l) => <option key={l.arquivo} value={l.arquivo}>{l.nome}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="Período" type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} /></div>
          <div className="w-40"><Field label="até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></div>
          <div className="w-40"><Field label="Empresas (1,2)" value={empresas} onChange={(e) => setEmpresas(e.target.value)} placeholder="esta loja" /></div>
        </div>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-80"><LookupField label="Centro de custo" recurso="lookup/plc" campoCodigo="codigo_extenso" descricao="descricao" disabled={!comPlc}
            parametros={{ lancavel: 'S' }} fixos={{ tipo_conta: 'DESPESA' }} value={plc ?? null} onChange={(c) => setPlc(c ?? undefined)} /></div>
          <div className="w-72"><Field label="Fornecedor" value={fornecedor} disabled={!comFornecedor} onChange={(e) => setFornecedor(e.target.value.toUpperCase())} /></div>
          <div className="w-40">
            <label className="mb-1 block text-body-sm text-fg-muted" htmlFor="cons-filtro">Filtro do fornecedor</label>
            <select id="cons-filtro" className={sel} value={filtroFornecedor} disabled={!comFornecedor} onChange={(e) => setFiltroFornecedor(e.target.value as typeof filtroFornecedor)}>
              {FILTROS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-gp-sm">
          <Button label="&Gerar" variant="soft" disabled={ocupado || !arquivo} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="filled" disabled={!arquivo} onClick={imprimir} />
        </div>
      </div>

      {res?.tipo === 'PARTICIPACAO' && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full text-body-sm">
            <thead><tr className="bg-bg-subtle text-left">
              {['Setores', 'Faturamento', '% Fat.', 'Lucro', '% Lucro', 'Markup', 'Markdown', 'Perda', 'Cupons'].map((t) => <th key={t} className="p-pad-xs">{t}</th>)}
            </tr></thead>
            <tbody>
              {(res.linhas ?? []).map((l, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="p-pad-xs">{String(l.setores ?? '')}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.resultado2)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{pct(l.resultado1)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.resultado4)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{pct(l.resultado3)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{pct(l.margem)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{pct(l.markdown)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.perca)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{Number(l.qtde_cupom ?? 0)}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-semibold"><td className="p-pad-xs" colSpan={9}>Perda sobre o faturamento: {pct(res.percPerda)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      {res?.tipo === 'RANKING' && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full text-body-sm">
            <thead><tr className="bg-bg-subtle text-left">
              {['Família', 'Qtde', 'Custo', 'Venda', 'Lucro', 'Marg. sist.', 'Marg. atual', 'Marg. ant.', 'Impostos', 'Lucro final', 'Peso'].map((t) => <th key={t} className="p-pad-xs">{t}</th>)}
            </tr></thead>
            <tbody>
              {(res.linhas ?? []).map((l, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="p-pad-xs">{String(l.familia ?? '')}</td>
                  <td className="p-pad-xs text-right tabular-nums">{Number(l.qtde ?? 0).toLocaleString('pt-BR')}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.vlcusto)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.vlvenda)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.vllucro)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{pct(l.margsis)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{pct(l.margatual)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{pct(l.margante)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.impost)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(l.lucrofin)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{pct(l.peso)}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-semibold"><td className="p-pad-xs" colSpan={11}>Lucro total: {moeda(res.geral)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
