import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { CFOPS_PADRAO_CURVA_ABC_FORNECEDOR, isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { SelectField } from '../../shared/ui/SelectField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { hojeNaLoja } from '../../shared/tempo';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';

/**
 * CURVA ABC POR FORNECEDOR (`FRMRELCURVAABCFORNECEDOR`, uRelCurvaABCFornecedor.pas) — a curva das COMPRAS: as notas de entrada
 * processadas do período por fornecedor e loja, com a classificação A/B/C pelas faixas da loja. O legado só imprime; a grade é do Apollo
 * e faz a mesma conta do script do .fr3.
 *  - Fornecedor: a razão, com o modo do TfrmFiltro (igual / começa / termina / contém); F3 abre a Pesquisa (GET_PARCEIROS, FRN='S').
 *  - CFOP: a lista padrão 1102,2102,1403,2403; F3 abre a GET_CFOP sem eles em multisseleção e o escolhido entra depois dos 4; vazia
 *    volta à padrão.
 *  - Data contábil (padrão) ou de emissão; "Mostrar vendas" leva as saídas dos produtos do fornecedor e o layout "com saidas".
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtde = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: unknown, casas = 2) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const hoje = () => hojeNaLoja();
const inicioDoMes = () => `${hoje().slice(0, 8)}01`;
const PADRAO = CFOPS_PADRAO_CURVA_ABC_FORNECEDOR.join(',');

type Linha = { codparceiro: number; razao: string | null; idempresa: number; qtde: number; totalnf: number; qtde_ven?: number | null; total_venda?: number | null; perc: number; perc_acumulado: number; abc: string };
type Resultado = { linhas: Linha[]; totais: Record<string, number> };

export function RelCurvaAbcFornecedorPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: inicioDoMes(), dataFim: hoje(), tipoData: 'contabil', fornecedor: '', modoFornecedor: 'contem', cfops: PADRAO, mostrarSaidas: false, empresas: '' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pesquisa, setPesquisa] = useState<'fornecedor' | 'cfop' | null>(null);

  const corpo = () => ({
    dataIni: f.dataIni, dataFim: f.dataFim, tipoData: f.tipoData, fornecedor: f.fornecedor.trim() || undefined, modoFornecedor: f.modoFornecedor,
    cfops: (f.cfops.trim() || PADRAO).split(',').map((c) => Number(c.trim())).filter((c) => Number.isInteger(c) && c > 0),
    mostrarSaidas: f.mostrarSaidas,
    empresas: f.empresas.split(',').map((e) => Number(e.trim())).filter((e) => Number.isInteger(e) && e > 0),
  });
  const consultar = async () => {
    if (!f.dataIni) return mensagem.erro('Período inicial deve ser informado. Verifique!');
    if (!f.dataFim) return mensagem.erro('Período final deve ser informado. Verifique!');
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/relatorios/curva-abc-fornecedor`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(corpo()) });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      const j = (await r.json()) as Resultado;
      setRes(j);
      if (!j.linhas.length) mensagem.erro('Não há movimento no filtro informado. Verifique!');
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const imprimir = () => {
    void imprimirRelatorio('/relatorios/curva-abc-fornecedor/impressao', corpo()).catch((e) => mensagem.erro(e));
  };
  // o edtCFOPExit: vazio volta à padrão; a vírgula do fim sai
  const sairCfop = () => setF((x) => ({ ...x, cfops: x.cfops.trim() ? x.cfops.trim().replace(/,+$/, '') : PADRAO }));

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Curva ABC por fornecedor" />
      <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&Período" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-44"><SelectField label="Data" options={[{ value: 'contabil', label: 'Data contábil' }, { value: 'emissao', label: 'Data emissão' }]}
            value={f.tipoData} onChange={(v) => setF({ ...f, tipoData: v || 'contabil' })} /></div>
          <div className="w-40"><Field label="&Empresas (1,2)" value={f.empresas} onChange={(e) => setF({ ...f, empresas: e.target.value.replace(/[^\d,]/g, '') })} placeholder="esta loja" /></div>
        </div>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-80">
            <Field label="&Fornecedor (razão)" value={f.fornecedor} placeholder="F3 pesquisa" onChange={(e) => setF({ ...f, fornecedor: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'F3') { e.preventDefault(); setPesquisa('fornecedor'); } }} />
          </div>
          <div className="w-40"><SelectField label="Filtro" options={[{ value: 'igual', label: 'Igual' }, { value: 'comeca', label: 'Começa com' }, { value: 'termina', label: 'Termina com' }, { value: 'contem', label: 'Contém' }]}
            value={f.modoFornecedor} onChange={(v) => setF({ ...f, modoFornecedor: v || 'contem' })} /></div>
          <Button label="…" variant="soft" onClick={() => setPesquisa('fornecedor')} />
          <div className="w-80">
            <Field label="&CFOP" value={f.cfops} placeholder="F3 pesquisa" onChange={(e) => setF({ ...f, cfops: e.target.value.replace(/[^\d,]/g, '') })} onBlur={sairCfop}
              onKeyDown={(e) => { if (e.key === 'F3') { e.preventDefault(); setPesquisa('cfop'); } }} />
          </div>
          <Button label="…" variant="soft" onClick={() => setPesquisa('cfop')} />
          <CheckboxField label="Mostrar &vendas" value={f.mostrarSaidas ? 'S' : 'N'} onChange={(v) => setF({ ...f, mostrarSaidas: v === 'S' })} />
        </div>
        <div className="flex flex-wrap gap-gp-sm">
          <Button label="&Consultar" disabled={ocupado} onClick={() => void consultar()} />
          <Button label="&Imprimir" variant="outline" disabled={ocupado} onClick={imprimir} />
        </div>
      </section>

      {pesquisa === 'fornecedor' && (
        // ChamaPesquisaParceiro (:191-195): GET_PARCEIROS com FRN = 'S', devolve a RAZAO
        <Pesquisa resourcePath="lookup/parceiros" fixos={{ frn: 'S' }} onFechar={() => setPesquisa(null)}
          onSelecionar={(l) => { setPesquisa(null); setF((x) => ({ ...x, fornecedor: String(l.razao ?? ''), modoFornecedor: 'igual' })); }} />
      )}
      {pesquisa === 'cfop' && (
        <Pesquisa resourcePath="lookup/cfops-curva-abc-fornecedor" multisselecao onFechar={() => setPesquisa(null)}
          onSelecionarVarios={(ls) => { setPesquisa(null); setF((x) => ({ ...x, cfops: [PADRAO, ...ls.map((l) => String(l.cfop ?? l.codigo))].join(',') })); }}
          onSelecionar={(l) => { setPesquisa(null); setF((x) => ({ ...x, cfops: `${PADRAO},${String(l.cfop ?? l.codigo)}` })); }} />
      )}

      {res && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full min-w-[900px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Emp.</th><th className="p-pad-xs">Cód.</th><th className="p-pad-xs">Razão</th>
                <th className="p-pad-xs text-right">Qtde</th><th className="p-pad-xs text-right">Compra</th>
                {f.mostrarSaidas && <><th className="p-pad-xs text-right">Qtde venda</th><th className="p-pad-xs text-right">Venda</th></>}
                <th className="p-pad-xs text-right">%</th><th className="p-pad-xs text-right">Acum. %</th><th className="p-pad-xs">ABC</th>
              </tr>
            </thead>
            <tbody>
              {res.linhas.map((l) => (
                <tr key={`${l.codparceiro}-${l.idempresa}`} className="border-b border-border">
                  <td className="p-pad-xs tabular-nums">{l.idempresa}</td><td className="p-pad-xs tabular-nums">{l.codparceiro}</td><td className="p-pad-xs">{l.razao ?? ''}</td>
                  <td className="p-pad-xs text-right tabular-nums">{qtde(l.qtde)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(l.totalnf)}</td>
                  {f.mostrarSaidas && <><td className="p-pad-xs text-right tabular-nums">{l.qtde_ven == null ? '' : qtde(l.qtde_ven)}</td><td className="p-pad-xs text-right tabular-nums">{l.total_venda == null ? '' : moeda(l.total_venda)}</td></>}
                  <td className="p-pad-xs text-right tabular-nums">{pct(l.perc, 4)}</td><td className="p-pad-xs text-right tabular-nums">{pct(l.perc_acumulado)}</td>
                  <td className="p-pad-xs font-semibold">{l.abc}</td>
                </tr>
              ))}
            </tbody>
            {res.linhas.length > 0 && (
              <tfoot>
                <tr className="font-semibold">
                  <td className="p-pad-xs" colSpan={3}>TOTAIS DO PERÍODO · {res.totais.fornecedores} linha(s)</td>
                  <td className="p-pad-xs text-right tabular-nums">{qtde(res.totais.qtde)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(res.totais.totalnf)}</td>
                  {f.mostrarSaidas && <><td className="p-pad-xs text-right tabular-nums">{qtde(res.totais.qtde_ven)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(res.totais.total_venda)}</td></>}
                  <td className="p-pad-xs" colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
