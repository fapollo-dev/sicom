import { useMemo, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { DateField } from '../../shared/ui/DateField';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useMensagem } from '../../shared/mensagem';
import {
  adicionarAoAgrupamento, agruparPagar, agruparReceber, buscarParaAgrupar, membrosAgrupamento, removerDoAgrupamento, reverterAgrupamento,
  type ConvenioSugestao, type FiltroAgrupar, type Lado, type TituloAgrupar,
} from './agrupamentoApi';

/**
 * AGRUPAR CONTAS A RECEBER / A PAGAR (`FRMAGRUPACONTASARECEBER` / `FRMAGRUPACONTASAPAGAR`; dossiê uAgrupaContas.md).
 * A busca traz os títulos abertos e não agrupados (no A Receber, com o fechamento de caixa da empresa, só os conciliados);
 * marcados um a um ou todos (T), viram um título consolidado — no A Receber com o juro das linhas de "Calc. juros", a taxa
 * administrativa e o desconto; no A Pagar com parcelas e centro de custo opcionais. Com clientes/fornecedores diversos, o
 * parceiro é obrigatório. No A Receber, o parceiro com o CNPJ da própria empresa é o convênio (A Pagar quitado + CAIXA na
 * despesa): a tela pede o centro de custo, a forma e a data. Abaixo, a consulta de um agrupamento pelo código do consolidado:
 * os títulos, reverter (e, no A Receber, adicionar e remover título).
 */
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const n = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));

export function AgrupamentoPage({ lado }: { lado: Lado }) {
  const ar = lado === 'areceber';
  const chave = ar ? 'codrcb' : 'codapg';
  const mensagem = useMensagem();
  const [filtro, setFiltro] = useState<FiltroAgrupar>({});
  const [titulos, setTitulos] = useState<TituloAgrupar[] | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [juros, setJuros] = useState<Set<number>>(new Set());
  const [f, setF] = useState({ codparceiro: '', idpgto: '', dtvenda: '', dtvenc: '', obs: '', desconto: '', taxa: false, codplc: '', parcelas: '' });
  const [convenio, setConvenio] = useState<(ConvenioSugestao & { codplcTxt: string; idpgtoTxt: string }) | null>(null);
  const [consulta, setConsulta] = useState<{ cod: string; membros: Array<Record<string, unknown>> | null }>({ cod: '', membros: null });
  const [ocupado, setOcupado] = useState(false);

  const executar = async (fn: () => Promise<void>) => {
    setOcupado(true);
    try { await fn(); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const cod = (t: TituloAgrupar) => Number(t[chave]);
  const pesquisar = () => executar(async () => {
    setTitulos(await buscarParaAgrupar(lado, filtro));
    setSel(new Set());
    setJuros(new Set());
    setConvenio(null);
  });
  const alternar = (id: number) => setSel((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const alternarJuro = (id: number) => setJuros((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  // a tecla T do legado: marca todos se nem todos estão marcados, senão desmarca
  const marcarTodos = () => setSel((s) => (titulos && s.size === titulos.length ? new Set() : new Set((titulos ?? []).map(cod))));

  const marcados = useMemo(() => (titulos ?? []).filter((t) => sel.has(cod(t))), [titulos, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const clientes = new Set(marcados.map((t) => Number(t.codparceiro)));
  // o total do legado (`SetaTotal`): Σ valor + Σ juro das linhas marcadas em "Calc. juros"; o desconto sai depois (a taxa é da empresa)
  const bruto = r2(marcados.reduce((s, t) => s + Number(t.valor ?? 0) + (ar && juros.has(cod(t)) ? Number(t.juro ?? 0) : 0), 0));
  const total = r2(bruto - (ar ? n(f.desconto) ?? 0 : 0));

  const parcelasAp = (): Array<{ valor: number; dtvenc: string }> | undefined => {
    const qtd = Number(f.parcelas || 0);
    if (!qtd || qtd <= 1 || !f.dtvenc) return undefined;
    const base = Math.floor((total / qtd) * 100) / 100;
    return Array.from({ length: qtd }, (_, i) => {
      const d = new Date(`${f.dtvenc}T12:00:00`);
      d.setMonth(d.getMonth() + i);
      return { valor: i === qtd - 1 ? r2(total - base * (qtd - 1)) : base, dtvenc: d.toISOString().slice(0, 10) };
    });
  };

  const agrupar = (comConvenio?: typeof convenio) => executar(async () => {
    if (!marcados.length) { mensagem.erro(new Error('Nenhum documento foi selecionado para realizar o agrupamento.')); return; }
    if (clientes.size > 1 && !n(f.codparceiro)) {
      mensagem.erro(new Error(ar
        ? 'Mais de um cliente foi selecionado para realizar o agrupamento, informe o parceiro para gerar o título.'
        : 'Foi detectado mais de um fornecedor, informe o parceiro para gerar o titulo!'));
      return;
    }
    if (ar) {
      try {
        const r = await agruparReceber({
          codrcbs: marcados.map(cod), codparceiro: n(f.codparceiro), idpgto: n(f.idpgto), dtvenda: f.dtvenda || undefined, dtvenc: f.dtvenc || undefined,
          obs: f.obs || undefined, desconto: n(f.desconto), jurosDe: [...juros].filter((j) => sel.has(j)), cobrarTaxaAdm: f.taxa,
          convenio: comConvenio ? { codplc: n(comConvenio.codplcTxt), idpgto: n(comConvenio.idpgtoTxt), data: comConvenio.data, obs: comConvenio.obs } : undefined,
        });
        mensagem.sucesso(r.convenio
          ? `A conta à pagar nº ${r.convenio.codapg} foi gerada com sucesso.`
          : `Agrupamento realizado: título ${r.consolidado} de ${moeda(r.total)} (${r.membros} documento(s)).`);
        setConvenio(null);
      } catch (e) {
        const env = (e as { envelope?: { code?: string; detalhe?: { sugestao?: ConvenioSugestao } } }).envelope;
        if (env?.code !== 'AGRUPAMENTO_CONVENIO_MESMO_CNPJ' || !env.detalhe?.sugestao) throw e;
        const s = env.detalhe.sugestao;
        setConvenio({ ...s, codplcTxt: s.codplc ? String(s.codplc) : '', idpgtoTxt: s.idpgto ? String(s.idpgto) : '' });
        mensagem.erro(new Error('Foi detectado que o CNPJ do cliente a receber é igual ao da empresa: informe os dados do convênio.'));
        return;
      }
    } else {
      const r = await agruparPagar({
        codapgs: marcados.map(cod), codparceiro: n(f.codparceiro), dtvenc: f.dtvenc || undefined, obs: f.obs || undefined, codplc: n(f.codplc), parcelas: parcelasAp(),
      });
      mensagem.sucesso(`Agrupamento realizado: título ${r.consolidado} de ${moeda(r.total)} (${r.membros} documento(s)).`);
    }
    setTitulos(await buscarParaAgrupar(lado, filtro));
    setSel(new Set());
    setJuros(new Set());
  });

  const consultar = () => executar(async () => {
    const id = Number(consulta.cod);
    if (!id) return;
    setConsulta({ cod: consulta.cod, membros: await membrosAgrupamento(lado, id) });
  });
  const reverter = () => executar(async () => {
    const id = Number(consulta.cod);
    if (!id || !window.confirm('Deseja realmente reverter o agrupamento?')) return;
    await reverterAgrupamento(lado, id);
    setConsulta({ cod: '', membros: null });
    mensagem.sucesso('Reversão realizada com sucesso.');
  });
  const remover = (membro: Record<string, unknown>) => executar(async () => {
    const id = Number(consulta.cod);
    if (!window.confirm(`Deseja realmente remover o título: Documento [${String(membro.duplicata ?? '')}] Dt. Venc. [${dataBr(membro.dtvenc)}] Valor [${moeda(membro.valor)}] do agrupamento?`)) return;
    await removerDoAgrupamento(id, Number(membro.codrcb));
    setConsulta({ cod: consulta.cod, membros: await membrosAgrupamento(lado, id) });
    mensagem.sucesso('Título removido com sucesso!');
  });
  const adicionarMarcados = () => executar(async () => {
    const id = Number(consulta.cod);
    if (!id || !marcados.length) { mensagem.erro(new Error('Marque na busca os títulos a incluir e informe o agrupamento.')); return; }
    await adicionarAoAgrupamento(id, marcados.map(cod));
    setConsulta({ cod: consulta.cod, membros: await membrosAgrupamento(lado, id) });
    setTitulos(await buscarParaAgrupar(lado, filtro));
    setSel(new Set());
    mensagem.sucesso('Título(s) incluído com sucesso!');
  });

  return (
    <div
      className="flex flex-col gap-gp-md"
      onKeyDown={(e) => { if ((e.key === 't' || e.key === 'T') && !(e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); marcarTodos(); } }}
    >
      <PageHeader title={ar ? 'Agrupar contas a receber' : 'Agrupar contas a pagar'} />

      <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label={ar ? 'Cliente (código)' : 'Fornecedor (código)'} inputMode="numeric" value={filtro.codparceiro ?? ''} onChange={(e) => setFiltro({ ...filtro, codparceiro: e.target.value })} /></div>
          <div className="w-40"><DateField label="Vencimento de" value={filtro.vencDe ?? ''} onChange={(v) => setFiltro({ ...filtro, vencDe: v ?? '' })} /></div>
          <div className="w-40"><DateField label="até" value={filtro.vencAte ?? ''} onChange={(v) => setFiltro({ ...filtro, vencAte: v ?? '' })} /></div>
          {ar && <div className="w-40"><DateField label="Venda de" value={filtro.vendaDe ?? ''} onChange={(v) => setFiltro({ ...filtro, vendaDe: v ?? '' })} /></div>}
          {ar && <div className="w-40"><DateField label="até " value={filtro.vendaAte ?? ''} onChange={(v) => setFiltro({ ...filtro, vendaAte: v ?? '' })} /></div>}
          <Button label="&Pesquisar" variant="soft" onClick={() => void pesquisar()} disabled={ocupado} />
          {titulos && titulos.length > 0 && <Button label="Marcar/desmarcar &todos (T)" variant="ghost" onClick={marcarTodos} />}
        </div>
        {titulos && (titulos.length === 0
          ? <small className="text-fg-muted">Nenhum título aberto com esses filtros.</small>
          : (
            <div className="max-h-96 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-fg-muted">
                    <th className="px-2 py-1" /><th className="px-2 py-1">Código</th><th className="px-2 py-1">Documento</th><th className="px-2 py-1">{ar ? 'Cliente' : 'Fornecedor'}</th>
                    <th className="px-2 py-1">Vencimento</th><th className="px-2 py-1 text-right">Valor</th>
                    {ar && <><th className="px-2 py-1 text-right">Juro</th><th className="px-2 py-1">Calc. juros</th></>}
                  </tr>
                </thead>
                <tbody>
                  {titulos.map((t) => (
                    <tr key={cod(t)} className="border-t border-border">
                      <td className="px-2 py-1"><CheckboxField label="Selecionar" value={sel.has(cod(t)) ? 'S' : 'N'} onChange={() => alternar(cod(t))} /></td>
                      <td className="px-2 py-1 tabular-nums">{cod(t)}</td>
                      <td className="px-2 py-1">{String(t.duplicata ?? '')}</td>
                      <td className="px-2 py-1">{Number(t.codparceiro)} · {String(t.razao ?? '')}</td>
                      <td className="px-2 py-1 tabular-nums">{dataBr(t.dtvenc)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{moeda(t.valor)}</td>
                      {ar && (
                        <>
                          <td className="px-2 py-1 text-right tabular-nums">{moeda(t.juro)}</td>
                          <td className="px-2 py-1"><CheckboxField label="Juro" value={juros.has(cod(t)) ? 'S' : 'N'} onChange={() => alternarJuro(cod(t))} /></td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </section>

      <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <small>
          {marcados.length} documento(s) · {clientes.size} {ar ? 'cliente(s)' : 'fornecedor(es)'} · total <strong className="tabular-nums">{moeda(total)}</strong>
        </small>
        <div className="grid grid-cols-2 gap-gp-sm md:grid-cols-4">
          <Field label="Parceiro do título (código)" inputMode="numeric" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value })} />
          {ar && <Field label="Forma de pagamento (código)" inputMode="numeric" value={f.idpgto} onChange={(e) => setF({ ...f, idpgto: e.target.value })} />}
          {ar && <DateField label="Data do lançamento" value={f.dtvenda} onChange={(v) => setF({ ...f, dtvenda: v ?? '' })} />}
          <DateField label="Vencimento" value={f.dtvenc} onChange={(v) => setF({ ...f, dtvenc: v ?? '' })} />
          {ar && <Field label="Desconto" inputMode="decimal" value={f.desconto} onChange={(e) => setF({ ...f, desconto: e.target.value })} />}
          {!ar && <Field label="Centro de custo (opcional)" inputMode="numeric" value={f.codplc} onChange={(e) => setF({ ...f, codplc: e.target.value })} />}
          {!ar && <Field label="Parcelas" inputMode="numeric" value={f.parcelas} onChange={(e) => setF({ ...f, parcelas: e.target.value })} />}
          <div className="col-span-2 md:col-span-4"><Field label="Observação" value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} /></div>
          {ar && <CheckboxField label="Cobrar taxa administrativa" value={f.taxa ? 'S' : 'N'} onChange={(v) => setF({ ...f, taxa: v === 'S' })} />}
        </div>
        {convenio && (
          <div className="flex flex-col gap-gp-sm rounded-md border border-border p-3">
            <strong className="text-sm">Convênio parceiro — o CNPJ do cliente é o da empresa: gera um A Pagar quitado e a CAIXA na despesa</strong>
            <div className="grid grid-cols-2 gap-gp-sm md:grid-cols-4">
              <Field label="Centro de custo (despesa)" inputMode="numeric" value={convenio.codplcTxt} onChange={(e) => setConvenio({ ...convenio, codplcTxt: e.target.value })} />
              <Field label="Forma de pagamento (código)" inputMode="numeric" value={convenio.idpgtoTxt} onChange={(e) => setConvenio({ ...convenio, idpgtoTxt: e.target.value })} />
              <DateField label="Vencimento da conta a pagar" value={convenio.data} onChange={(v) => setConvenio({ ...convenio, data: v ?? convenio.data })} />
              <div className="col-span-2 md:col-span-4"><Field label="Observação" value={convenio.obs} onChange={(e) => setConvenio({ ...convenio, obs: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-gp-sm">
              <Button label="Cancelar" variant="ghost" onClick={() => setConvenio(null)} disabled={ocupado} />
              <Button label="&Gravar baixa" onClick={() => void agrupar(convenio)} disabled={ocupado} />
            </div>
          </div>
        )}
        {!convenio && <div className="flex justify-end"><Button label="&Agrupar" onClick={() => void agrupar()} disabled={ocupado || marcados.length === 0} /></div>}
      </section>

      <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <strong className="text-sm">Consultar agrupamento</strong>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-44"><Field label="Título consolidado (código)" inputMode="numeric" value={consulta.cod} onChange={(e) => setConsulta({ cod: e.target.value, membros: null })} /></div>
          <Button label="&Consultar" variant="soft" onClick={() => void consultar()} disabled={ocupado} />
          {consulta.membros && <Button label="&Reverter agrupamento" variant="ghost" onClick={() => void reverter()} disabled={ocupado} />}
          {ar && consulta.membros && <Button label="Incluir os marcados" variant="ghost" onClick={() => void adicionarMarcados()} disabled={ocupado || marcados.length === 0} />}
        </div>
        {consulta.membros && (consulta.membros.length === 0
          ? <small className="text-fg-muted">O agrupamento não tem títulos.</small>
          : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-fg-muted"><th className="px-2 py-1">Código</th><th className="px-2 py-1">Documento</th><th className="px-2 py-1">Vencimento</th><th className="px-2 py-1 text-right">Valor</th><th className="px-2 py-1">Quitado</th><th className="px-2 py-1" /></tr></thead>
              <tbody>
                {consulta.membros.map((m) => (
                  <tr key={String(m[chave])} className="border-t border-border">
                    <td className="px-2 py-1 tabular-nums">{String(m[chave])}</td><td className="px-2 py-1">{String(m.duplicata ?? '')}</td>
                    <td className="px-2 py-1 tabular-nums">{dataBr(m.dtvenc)}</td><td className="px-2 py-1 text-right tabular-nums">{moeda(m.valor)}</td>
                    <td className="px-2 py-1">{m.quitada === 'S' ? 'Sim' : 'Não'}</td>
                    <td className="px-2 py-1 text-right">{ar && <Button label="Remover" variant="ghost" onClick={() => void remover(m)} disabled={ocupado} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </section>
    </div>
  );
}

export const AgruparReceberPage = () => <AgrupamentoPage lado="areceber" />;
export const AgruparPagarPage = () => <AgrupamentoPage lado="apagar" />;
