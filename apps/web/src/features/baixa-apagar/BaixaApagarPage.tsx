import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { DateField } from '../../shared/ui/DateField';
import { SelectField } from '../../shared/ui/SelectField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  contasBaixa, gravarBaixa, iniciarBaixa, manutencaoBaixa, padroesBaixa, titulosBaixa,
  type ContaBaixa, type FiltroTitulos, type PadroesBaixa, type TituloBaixa,
} from './baixaApagarApi';

/**
 * BAIXA DE CONTAS A PAGAR (`FRMBAIXAAPAGAR`, `UBaixaApagar.pas`; `uBaixaApagar-spec.md`). "Iniciar baixa" aloca o lote; a
 * pesquisa traz os títulos abertos e o operador marca os do lote. Na grade, "Calcula juro" e o acréscimo/desconto (que já
 * vem com o desconto do título) são editáveis. Os recursos saem de contas correntes: DINHEIRO (a única aceita na conta
 * caixa), DOC, TRANSFERÊNCIA e DÉBITO EM CONTA. Recurso a menos que o total pergunta pela baixa parcial, que gera um título
 * com o saldo. A manutenção (vinda da consulta de baixas) reabre um lote e regrava num lote novo.
 */
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(/\./g, '').replace(',', '.')));
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

interface DocGrade extends TituloBaixa { calculaJuro: boolean; acreDesc: number }
interface Recurso { tipo: number; codconta: number; valor: number; historico: string }

/** `cdsDoctosCalcFields` (UdmBaixaApagar.pas:344-373): juro simples diário, só com "Calcula juro" e em atraso */
function jurosDoc(d: DocGrade, dtpgto: string): number {
  if (!d.calculaJuro || !(d.txjuros > 0) || !d.vencimento || dtpgto <= d.vencimento) return 0;
  const dias = Math.round((Date.parse(dtpgto) - Date.parse(d.vencimento)) / 86_400_000);
  return r2((d.txjuros / 100 / 30) * d.base * dias);
}

export function BaixaApagarPage() {
  const mensagem = useMensagem();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [padroes, setPadroes] = useState<PadroesBaixa | null>(null);
  const [contas, setContas] = useState<ContaBaixa[]>([]);
  const [lote, setLote] = useState<number | null>(null);
  const [loteManutencao, setLoteManutencao] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<FiltroTitulos>({});
  const [pesquisa, setPesquisa] = useState<TituloBaixa[] | null>(null);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [docs, setDocs] = useState<DocGrade[]>([]);
  const [dtpgto, setDtpgto] = useState(hoje());
  const [cc, setCc] = useState({ juros: '', acrescimo: '', desconto: '' });
  const [recursos, setRecursos] = useState<Recurso[]>([]);
  const [novo, setNovo] = useState<{ tipo: string; codconta: string; valor: string; historico: string } | null>(null);
  const [dtvencSaldo, setDtvencSaldo] = useState(hoje());
  const [ocupado, setOcupado] = useState(false);

  const executar = async (fn: () => Promise<void>) => {
    setOcupado(true);
    try { await fn(); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  useEffect(() => {
    void executar(async () => {
      const [p, c] = await Promise.all([padroesBaixa(), contasBaixa()]);
      setPadroes(p);
      setContas(c);
      setCc({ juros: p.ccJuros ? String(p.ccJuros) : '', acrescimo: p.ccAcrescimo ? String(p.ccAcrescimo) : '', desconto: p.ccDesconto ? String(p.ccDesconto) : '' });
      // a manutenção chega da consulta de baixas: valida o lote, traz os documentos e a data, e aloca um lote novo
      const m = Number(params.get('manutencao') ?? 0);
      if (m > 0) {
        const r = await manutencaoBaixa(m);
        setLoteManutencao(r.loteAntigo);
        setDtpgto(r.dtpgto || hoje());
        setDocs(r.documentos.map((d) => ({ ...d, calculaJuro: !!d.calcula_juro, acreDesc: d.acre_desc })));
        setLote((await iniciarBaixa()).idlote);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalDocs = useMemo(() => r2(docs.reduce((s, d) => s + d.base + jurosDoc(d, dtpgto) + d.acreDesc, 0)), [docs, dtpgto]);
  const totalJuros = useMemo(() => r2(docs.reduce((s, d) => s + jurosDoc(d, dtpgto), 0)), [docs, dtpgto]);
  const totalRecursos = r2(recursos.reduce((s, r) => s + r.valor, 0));
  const restante = r2(totalDocs - totalRecursos);

  // os avisos de data do legado (`edtDataBaixaExit`, :1586-1639): só avisam, não impedem gravar
  const avisoData = (() => {
    if (!padroes) return '';
    const h = hoje();
    if (padroes.diasFutura > 0) {
      const lim = new Date(`${h}T12:00:00`);
      lim.setDate(lim.getDate() + padroes.diasFutura);
      if (dtpgto > lim.toISOString().slice(0, 10)) return 'A data informada para baixa excede a quantidade de dias permitidos para baixa futura!';
    }
    if (!padroes.permiteRetroativa && dtpgto < h) return 'Não é permitido realizar a baixa de contas informando a data retroativa!';
    return '';
  })();

  const iniciar = () => executar(async () => {
    setLote((await iniciarBaixa()).idlote);
    setLoteManutencao(null);
    setDocs([]);
    setRecursos([]);
    setNovo(null);
    setDtpgto(hoje());
    setPesquisa(await titulosBaixa(filtro));
    setMarcados(new Set());
  });
  const pesquisar = () => executar(async () => {
    setPesquisa(await titulosBaixa(filtro));
    setMarcados(new Set());
  });
  const alternar = (id: number) => setMarcados((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const adicionar = () => {
    // "Exclua os recursos antes de adicionar um documento." (:896-897)
    if (recursos.length) { mensagem.erro(new Error('Exclua os recursos antes de adicionar um documento.')); return; }
    const ja = new Set(docs.map((d) => d.codapg));
    const novos = (pesquisa ?? []).filter((t) => marcados.has(t.codapg) && !ja.has(t.codapg)).map((t) => ({ ...t, calculaJuro: false, acreDesc: t.acre_desc }));
    setDocs([...docs, ...novos]);
    setMarcados(new Set());
  };
  const excluirDoc = (codapg: number) => {
    if (recursos.length) { mensagem.erro(new Error('Exclua os recursos antes de excluir um documento.')); return; }
    if (!window.confirm('Deseja realmente excluir este documento?')) return;
    setDocs(docs.filter((d) => d.codapg !== codapg));
  };
  const mudarDoc = (codapg: number, p: Partial<DocGrade>) => setDocs(docs.map((d) => (d.codapg === codapg ? { ...d, ...p } : d)));

  const abrirRecurso = () => {
    if (!docs.length) { mensagem.erro(new Error('Nenhum documento foi selecionado ainda.')); return; }
    // "Total de recursos ja informado!" (:277-282)
    if (restante <= 0) { mensagem.erro(new Error('Total de recursos ja informado!')); return; }
    setNovo({ tipo: '0', codconta: '', valor: String(restante).replace('.', ','), historico: `REFERENTE A BAIXA DO LOTE: ${lote ?? ''}` });
  };
  const salvarRecurso = () => {
    if (!novo) return;
    const valor = num(novo.valor) ?? 0;
    const tipo = Number(novo.tipo);
    const conta = contas.find((c) => c.codconta === Number(novo.codconta));
    if (!(valor > 0)) { mensagem.erro(new Error('Valor deve ser maior que zero!')); return; }
    if (valor > restante) { mensagem.erro(new Error('Valor superior ao restante da baixa!')); return; }
    if (!conta) { mensagem.erro(new Error('Informe a conta corrente.')); return; }
    const t = padroes?.recursos.find((x) => x.tipo === tipo);
    if (conta.caixa && t && !t.contaCaixa) { mensagem.erro(new Error('Esta conta corrente é conta caixa, não permite operações bancárias.')); return; }
    if (conta.cbo_baixa_cp !== 'S') { mensagem.erro(new Error('O operador não possui permissão para baixar contas a pagar nesta conta corrente.')); return; }
    setRecursos([...recursos, { tipo, codconta: conta.codconta, valor: r2(valor), historico: novo.historico }]);
    setNovo(null);
  };

  const gravar = () => executar(async () => {
    if (!lote) return;
    if (!docs.length) { mensagem.erro(new Error('Nenhum documento foi informado para realizar a baixa.')); return; }
    if (!recursos.length) { mensagem.erro(new Error('Nenhum recurso foi informado.')); return; }
    if (novo) { mensagem.erro(new Error('Salve o recurso antes de gravar a baixa.')); return; }
    let parcial: { dtvenc: string } | undefined;
    if (restante > 0) {
      if (!window.confirm('Total de recursos não confere com o total dos documentos. Deseja gerar uma baixa parcial?')) return;
      if (new Set(docs.map((d) => d.codparceiro)).size > 1) {
        mensagem.erro(new Error('A baixa parcial de documentos só pode ser gerada para documentos a pagar do mesmo fornecedor!'));
        return;
      }
      parcial = { dtvenc: dtvencSaldo };
    }
    const r = await gravarBaixa({
      idlote: lote, dtpgto,
      documentos: docs.map((d) => ({ codapg: d.codapg, calculaJuro: d.calculaJuro, acreDesc: d.acreDesc })),
      recursos: recursos.map((x) => ({ tipo: x.tipo, codconta: x.codconta, valor: x.valor, historico: x.historico })),
      ccJuros: num(cc.juros), ccAcrescimo: num(cc.acrescimo), ccDesconto: num(cc.desconto),
      parcial, loteManutencao: loteManutencao ?? undefined,
    });
    mensagem.sucesso(`Documentos baixados com sucesso. Lote ${r.idlote}${r.codapgSaldo ? ` — saldo no título ${r.codapgSaldo}` : ''}.`);
    setLote(null);
    setLoteManutencao(null);
    setDocs([]);
    setRecursos([]);
    setPesquisa(null);
    if (params.get('manutencao')) navigate('/cobranca/baixa-apagar', { replace: true });
  });
  const cancelar = () => {
    setLote(null);
    setLoteManutencao(null);
    setDocs([]);
    setRecursos([]);
    setNovo(null);
    setPesquisa(null);
  };

  const nomeConta = (c: ContaBaixa) => `${c.nroconta ?? c.codconta} · ${c.titular ?? ''}${c.caixa ? ' (caixa)' : ''}`;
  const tipoSel = padroes?.recursos.find((x) => x.tipo === Number(novo?.tipo ?? 0));
  const contasDoTipo = contas.filter((c) => !c.caixa || tipoSel?.contaCaixa);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Baixa de contas a pagar" />

      <section className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        {!lote && <Button label="&Iniciar baixa" onClick={() => void iniciar()} disabled={ocupado} />}
        {lote && (
          <>
            <strong className="text-sm">Lote {lote}{loteManutencao ? ` · manutenção do lote ${loteManutencao}` : ''}</strong>
            <div className="w-44"><DateField label="&Data da baixa" value={dtpgto} onChange={(v) => setDtpgto(v ?? hoje())} /></div>
            {avisoData && <small className="text-warning">{avisoData}</small>}
            <div className="flex-1" />
            <Button label="Cancelar" variant="ghost" onClick={cancelar} disabled={ocupado} />
            <Button label="&Gravar baixa" onClick={() => void gravar()} disabled={ocupado || !docs.length || !recursos.length} />
          </>
        )}
      </section>

      {lote && !loteManutencao && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <strong className="text-sm">Documentos a pagar em aberto</strong>
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-56"><Field label="Documento ou fornecedor" value={filtro.busca ?? ''} onChange={(e) => setFiltro({ ...filtro, busca: e.target.value })} /></div>
            <div className="w-36"><Field label="Fornecedor (código)" inputMode="numeric" value={filtro.codparceiro ?? ''} onChange={(e) => setFiltro({ ...filtro, codparceiro: e.target.value })} /></div>
            <div className="w-40"><DateField label="Vencimento de" value={filtro.vencDe ?? ''} onChange={(v) => setFiltro({ ...filtro, vencDe: v ?? '' })} /></div>
            <div className="w-40"><DateField label="até" value={filtro.vencAte ?? ''} onChange={(v) => setFiltro({ ...filtro, vencAte: v ?? '' })} /></div>
            {padroes && padroes.empresas.length > 1 && (
              <div className="w-44"><Field label="Empresas (códigos)" value={(filtro.empresas ?? []).join(',')} onChange={(e) => setFiltro({ ...filtro, empresas: e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) })} /></div>
            )}
            <Button label="&Pesquisar" variant="soft" onClick={() => void pesquisar()} disabled={ocupado} />
            <Button label="&Adicionar marcados" variant="ghost" onClick={adicionar} disabled={ocupado || marcados.size === 0} />
          </div>
          {pesquisa && (pesquisa.length === 0
            ? <small className="text-fg-muted">Nenhum documento em aberto com esses filtros.</small>
            : (
              <div className="max-h-72 overflow-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-fg-muted">
                      <th className="px-2 py-1" /><th className="px-2 py-1">Documento</th><th className="px-2 py-1">Fornecedor</th><th className="px-2 py-1">Empresa</th>
                      <th className="px-2 py-1">Vencimento</th><th className="px-2 py-1 text-right">Valor</th><th className="px-2 py-1 text-right">Desconto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pesquisa.map((t) => (
                      // a cor do legado (:309-323): compromisso bloqueado em vermelho, fornecedor com débito em azul — só colore
                      <tr key={t.codapg} className={`border-t border-border ${t.bloqueio === 'S' ? 'text-danger' : t.fornecedor_possui_debito === 'S' ? 'text-info' : ''}`}>
                        <td className="px-2 py-1"><CheckboxField label="Selecionar" value={marcados.has(t.codapg) ? 'S' : 'N'} onChange={() => alternar(t.codapg)} /></td>
                        <td className="px-2 py-1">{t.nr_documento ?? ''}{t.nrparcela ? ` (${t.nrparcela})` : ''}</td>
                        <td className="px-2 py-1">{t.codparceiro} · {t.fornecedor ?? ''}</td>
                        <td className="px-2 py-1 tabular-nums">{t.codempresa}</td>
                        <td className="px-2 py-1 tabular-nums">{dataBr(t.vencimento)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{moeda(t.base)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{t.desconto ? moeda(t.desconto) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </section>
      )}

      {lote && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <strong className="text-sm">Documentos da baixa</strong>
          {docs.length === 0 ? <small className="text-fg-muted">Marque documentos na pesquisa e adicione.</small> : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-fg-muted">
                    <th className="px-2 py-1">Documento</th><th className="px-2 py-1">Fornecedor</th><th className="px-2 py-1">Calcula juro</th>
                    <th className="px-2 py-1 text-right">Valor</th><th className="px-2 py-1 text-right">Tx. juros</th><th className="px-2 py-1 text-right">Valor juros</th>
                    <th className="px-2 py-1 text-right">Acre / Desc</th><th className="px-2 py-1 text-right">Total c/ juros</th>
                    <th className="px-2 py-1">Emissão</th><th className="px-2 py-1">Vencimento</th><th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => {
                    const j = jurosDoc(d, dtpgto);
                    return (
                      <tr key={d.codapg} className="border-t border-border">
                        <td className="px-2 py-1">{d.nr_documento ?? ''}</td>
                        <td className="px-2 py-1">{d.fornecedor ?? ''}</td>
                        <td className="px-2 py-1"><CheckboxField label="Juro" value={d.calculaJuro ? 'S' : 'N'} onChange={(v) => mudarDoc(d.codapg, { calculaJuro: v === 'S' })} disabled={recursos.length > 0} /></td>
                        <td className="px-2 py-1 text-right tabular-nums">{moeda(d.base)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{d.txjuros ? `${d.txjuros}%` : ''}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{j ? moeda(j) : ''}</td>
                        <td className="w-28 px-2 py-1">
                          <input
                            aria-label={`Acréscimo ou desconto do documento ${d.nr_documento ?? d.codapg}`}
                            className="w-full rounded border border-border bg-bg-surface px-1 text-right tabular-nums"
                            inputMode="decimal" disabled={recursos.length > 0}
                            defaultValue={String(d.acreDesc).replace('.', ',')}
                            onBlur={(e) => mudarDoc(d.codapg, { acreDesc: r2(num(e.target.value) ?? 0) })}
                          />
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{moeda(d.base + j + d.acreDesc)}</td>
                        <td className="px-2 py-1 tabular-nums">{dataBr(d.emissao)}</td>
                        <td className="px-2 py-1 tabular-nums">{dataBr(d.vencimento)}</td>
                        <td className="px-2 py-1">{!loteManutencao && <Button label="Excluir" variant="ghost" onClick={() => excluirDoc(d.codapg)} disabled={ocupado} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap gap-gp-md text-sm">
            <span>Total a baixar <strong className="tabular-nums">{moeda(totalDocs)}</strong></span>
            <span>Total de juros <strong className="tabular-nums">{moeda(totalJuros)}</strong></span>
          </div>
          <div className="grid grid-cols-1 gap-gp-sm sm:grid-cols-3">
            <Field label="CC de juros" inputMode="numeric" value={cc.juros} onChange={(e) => setCc({ ...cc, juros: e.target.value })} />
            <Field label="CC de acréscimos" inputMode="numeric" value={cc.acrescimo} onChange={(e) => setCc({ ...cc, acrescimo: e.target.value })} />
            <Field label="CC de descontos recebidos" inputMode="numeric" value={cc.desconto} onChange={(e) => setCc({ ...cc, desconto: e.target.value })} />
          </div>
        </section>
      )}

      {lote && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex flex-wrap items-center gap-gp-sm">
            <strong className="text-sm">Recursos</strong>
            <span className="text-sm">Restante <strong className="tabular-nums">{moeda(restante)}</strong></span>
            <div className="flex-1" />
            {!novo && <Button label="Adicionar &recurso" variant="soft" onClick={abrirRecurso} disabled={ocupado} />}
          </div>
          {novo && (
            <div className="grid grid-cols-1 gap-gp-sm rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-4">
              <SelectField label="Tipo" value={novo.tipo} onChange={(v) => setNovo({ ...novo, tipo: v, codconta: '' })}
                options={(padroes?.recursos ?? []).map((t) => ({ value: String(t.tipo), label: t.rotulo }))} />
              <SelectField label="Conta corrente" value={novo.codconta} onChange={(v) => setNovo({ ...novo, codconta: v })} placeholder="(escolha a conta)"
                options={contasDoTipo.map((c) => ({ value: String(c.codconta), label: nomeConta(c) }))} />
              <Field label="Valor" inputMode="decimal" value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} />
              <div className="sm:col-span-2 lg:col-span-4"><Field label="Histórico" value={novo.historico} onChange={(e) => setNovo({ ...novo, historico: e.target.value })} /></div>
              <div className="flex justify-end gap-gp-sm sm:col-span-2 lg:col-span-4">
                <Button label="Cancelar" variant="ghost" onClick={() => setNovo(null)} />
                <Button label="&Salvar recurso" onClick={salvarRecurso} />
              </div>
            </div>
          )}
          {recursos.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-fg-muted"><th className="px-2 py-1">Tipo</th><th className="px-2 py-1">Conta</th><th className="px-2 py-1">Histórico</th><th className="px-2 py-1 text-right">Valor</th><th className="px-2 py-1" /></tr></thead>
                <tbody>
                  {recursos.map((r, i) => {
                    const c = contas.find((x) => x.codconta === r.codconta);
                    return (
                      <tr key={i} className="border-t border-border">
                        <td className="px-2 py-1">{padroes?.recursos.find((t) => t.tipo === r.tipo)?.rotulo}</td>
                        <td className="px-2 py-1">{c ? nomeConta(c) : r.codconta}</td>
                        <td className="px-2 py-1">{r.historico}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{moeda(r.valor)}</td>
                        <td className="px-2 py-1"><Button label="Excluir" variant="ghost" onClick={() => setRecursos(recursos.filter((_, k) => k !== i))} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {restante > 0 && recursos.length > 0 && (
            <div className="flex flex-wrap items-end gap-gp-sm">
              <small className="text-fg-muted">Faltam {moeda(restante)}: ao gravar, a baixa parcial gera um título com o saldo.</small>
              <div className="w-44"><DateField label="Vencimento do saldo" value={dtvencSaldo} onChange={(v) => setDtvencSaldo(v ?? hoje())} /></div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
