import { useEffect, useMemo, useState } from 'react';
import { Modal, PageHeader } from '@apollosg/design-system';
import { DateField } from '../../shared/ui/DateField';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { SelectField } from '../../shared/ui/SelectField';
import { listarOperadoras, type Operadora } from '../cartao/cartaoApi';
import { useMensagem } from '../../shared/mensagem';
import {
  abrirTurno, detalheTurno, documentosTurno, editarDocumento, efetivarTurno, listarTurnos, reabrirTurno, salvarRascunho,
  type CamposDocumento, type DetalheTurno, type DocumentoConferencia, type Documentos, type Fixa, type LinhaFechamento, type TurnoRef, type TurnoResumo,
} from './fechamentoCaixaApi';

/**
 * FECHAMENTO DE CAIXA (`FRMFECHAMENTOCAIXA`, 41 mil acessos) — corte 1: a CONFERÊNCIA do turno do PDV e o RASCUNHO
 * (dossiê uFechamentoCaixa-finalizacao.md). Os turnos do dia ("Caixas em aberto"); abrir um turno aberto completa o
 * movimento com as modalidades zeradas e abre a finalização; cada operação é conferida pelos documentos (cartões,
 * convênios, cheques, tickets) e o dinheiro pelo contado + sangria − suprimento. O rascunho é gravado ao sair, como
 * no legado. Efetivar (corte 2) grava o caixa gerencial, a conta bancária, o saldo do operador e a quebra, e fecha o turno;
 * com a integração automática, contabiliza (corte 3) — o que falhar fica pendente para o TRON e aparece como aviso.
 * Reabrir (corte 3) desfaz o fechamento do turno fechado na tesouraria.
 */
const moeda = (v: number | null | undefined) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const hora = (v: string | null) => (v ? v.slice(11, 16) : '');
const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
const SITUACAO: Record<number, { rotulo: string; cor: string }> = {
  1: { rotulo: 'Aberto', cor: 'text-fg-default' },
  2: { rotulo: 'Fechado no caixa', cor: 'text-fg-danger' },
  3: { rotulo: 'Fechado na tesouraria', cor: 'text-fg-success' },
};
const FIXAS: Fixa[] = ['SANGRIA EM DINHEIRO', 'SANGRIA EM CHEQUE', 'OUTRAS SANGRIAS', 'SUPRIMENTO'];

interface Conferida { codigos: number[]; total: number }
/** o formulário de edição de um documento (UConsDocs.AlteraDocs): tudo em texto, convertido ao gravar */
interface Edicao { doc: DocumentoConferencia; f: Record<keyof CamposDocumento, string> }
const txt = (v: unknown) => (v == null ? '' : String(v));

export function FechamentoCaixaPage() {
  const mensagem = useMensagem();
  const [data, setData] = useState(hoje());
  const [turnos, setTurnos] = useState<TurnoResumo[] | null>(null);
  const [ref, setRef] = useState<TurnoRef | null>(null);
  const [det, setDet] = useState<DetalheTurno | null>(null);
  const [contado, setContado] = useState('0');
  const [conferidas, setConferidas] = useState<Map<string, Conferida>>(new Map());
  const [docs, setDocs] = useState<{ d: Documentos; marcados: Set<number>; aConferir: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [gerarSaldo, setGerarSaldo] = useState(false); // CkSaldoOperador — marcada sozinha acima do limite
  const [avisos, setAvisos] = useState<string[]>([]);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [operadoras, setOperadoras] = useState<Operadora[]>([]);
  useEffect(() => {
    if (docs?.d.tipo === 'CARTAO' && docs.d.edicao && operadoras.length === 0) listarOperadoras().then(setOperadoras).catch(() => undefined);
  }, [docs, operadoras.length]);

  const executar = async (f: () => Promise<void>) => {
    setOcupado(true);
    try { await f(); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const pesquisar = () => executar(async () => { setTurnos(await listarTurnos(data)); });

  const carregar = (d: DetalheTurno) => {
    setDet(d);
    setAvisos((d.efetivado?.contabil?.avisos ?? []).map((a) => `${a.documento}: ${a.mensagem}`));
    setContado(String(d.dinheiroContado ?? 0));
    setConferidas(new Map());
    setGerarSaldo(false);
  };

  const abrir = (t: TurnoResumo) => executar(async () => {
    const r: TurnoRef = { data, chave: t.chave, nropdv: t.nropdv, codoperadora: t.codoperadora, situacao: t.situacao };
    setRef(r);
    // turno aberto: completa o movimento e abre para fechar; fechado: consulta
    carregar(t.situacao === 1 ? await abrirTurno(r) : await detalheTurno(r));
  });

  const consulta = det?.modo !== 'fechamento';
  const contadoNum = Number(String(contado).replace(',', '.')) || 0;

  const realDe = (l: LinhaFechamento): number => {
    if (!det || consulta) return l.real ?? 0;
    const c = conferidas.get(l.operacao);
    if (c) return c.total;
    if (l.linhaDinheiro && det.contadoHabilitado) return r2(contadoNum + det.fixas['SANGRIA EM DINHEIRO'] - det.fixas.SUPRIMENTO);
    return l.real ?? 0;
  };

  const totais = useMemo(() => {
    if (!det) return null;
    const real = r2(det.linhas.reduce((s, l) => s + realDe(l), 0));
    return { real, diferenca: r2(real - det.totais.fechamento + det.totais.devolucaoDinheiro) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [det, conferidas, contadoNum]);

  const verDocumentos = (operacao: string, aConferir: number) => executar(async () => {
    if (!ref) return;
    const d = await documentosTurno(ref, operacao);
    const c = conferidas.get(operacao);
    setDocs({ d, aConferir, marcados: new Set(c ? c.codigos : d.documentos.filter((x) => x.sel).map((x) => x.codigo)) });
  });

  // EDITAR (F2/Enter do legado, UConsDocs.AlteraDocs): o cartão e o A Receber; no cartão do turno fechado no PDV, só a operadora
  const editar = (x: DocumentoConferencia) => setEdicao({
    doc: x,
    f: {
      valor: txt(x.valor), codoperadora: txt(x.codoperadora), nsu: txt(x.nsu), nsuhost: txt(x.nsuhost), autorizacao: txt(x.autorizacao),
      codrede: txt(x.codrede), nroparcela: txt(x.nroparcela), obs: txt(x.obs), dtvenc: txt(x.dtvenc), codparceiro: txt(x.codparceiro),
    },
  });
  const campo = (k: keyof CamposDocumento) => ({
    value: edicao?.f[k] ?? '',
    onChange: (e: { target: { value: string } }) => setEdicao((s) => (s ? { ...s, f: { ...s.f, [k]: e.target.value } } : s)),
  });
  const gravarEdicao = () => executar(async () => {
    if (!ref || !docs || !edicao) return;
    const f = edicao.f;
    const n = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));
    const campos: CamposDocumento = docs.d.tipo === 'CARTAO'
      ? docs.d.edicao === 'operadora'
        ? { codoperadora: n(f.codoperadora) }
        : { valor: n(f.valor), codoperadora: n(f.codoperadora), nsu: f.nsu, nsuhost: f.nsuhost, autorizacao: f.autorizacao, codrede: n(f.codrede), nroparcela: n(f.nroparcela), obs: f.obs }
      : { valor: n(f.valor), dtvenc: f.dtvenc || undefined, codparceiro: n(f.codparceiro), obs: f.obs };
    await editarDocumento(ref, docs.d.operacao, edicao.doc.codigo, campos);
    const d = await documentosTurno(ref, docs.d.operacao);
    setDocs((s) => (s ? { ...s, d } : s));
    setEdicao(null);
    // na consulta o REAL vem do banco: recarrega o turno para refletir o valor novo
    if (consulta) setDet(await detalheTurno(ref));
    mensagem.sucesso('Documento alterado.');
  });

  const alternar = (cod: number) => setDocs((s) => {
    if (!s || !s.d.marcacaoLivre) return s;
    const m = new Set(s.marcados);
    if (m.has(cod)) m.delete(cod); else m.add(cod);
    return { ...s, marcados: m };
  });
  // a tecla T do legado: marca todos se nem todos estão marcados, senão desmarca (UConsDocs.pas:1601)
  const marcarTodos = () => setDocs((s) => {
    if (!s || !s.d.marcacaoLivre) return s;
    const todos = s.marcados.size === s.d.documentos.length;
    return { ...s, marcados: todos ? new Set() : new Set(s.d.documentos.map((x) => x.codigo)) };
  });

  // fechar o diálogo confirma (RealizaConf): a seleção da operação vira o REAL dela
  const confirmarDocs = () => {
    if (!docs) return;
    if (docs.d.marcacaoLivre && !consulta) {
      const codigos = docs.d.documentos.filter((x) => docs.marcados.has(x.codigo)).map((x) => x.codigo);
      const total = r2(docs.d.documentos.filter((x) => docs.marcados.has(x.codigo)).reduce((s, x) => s + x.valor, 0));
      setConferidas((m) => new Map(m).set(docs.d.operacao, { codigos, total }));
    }
    setDocs(null);
  };

  const gravar = async () => {
    if (!ref || !det || consulta) return;
    const r = await salvarRascunho(ref, {
      dinheiroContado: contadoNum,
      documentos: [...conferidas].map(([operacao, c]) => ({ operacao, codigos: c.codigos })),
    });
    carregar(r);
  };

  const salvar = () => executar(async () => { await gravar(); mensagem.sucesso('Conferência gravada.'); });
  // a caixa do saldo do operador vem marcada quando a diferença passa do limite da empresa (VerificaCheckGeralSaldo)
  const saldoAutomatico = !!det && !!totais && det.limiteSaldo !== 0 && Math.abs(totais.diferenca) > det.limiteSaldo;
  // EFETIVAR (btnFechaClick): as perguntas do legado, depois a gravação numa transação
  const efetivar = () => executar(async () => {
    if (!ref || !det || consulta || !totais) return;
    if (!window.confirm('Confirma a efetivação do fechamento?')) return;
    if (totais.diferenca !== 0 && !window.confirm('Operador(a) com saldo em caixa, deseja continuar?')) return;
    const corpo = {
      dinheiroContado: contadoNum,
      documentos: [...conferidas].map(([operacao, cfd]) => ({ operacao, codigos: cfd.codigos })),
      gerarSaldo: gerarSaldo || saldoAutomatico,
    };
    let r: DetalheTurno;
    try {
      r = await efetivarTurno(ref, corpo);
    } catch (e) {
      const env = (e as { envelope?: { code?: string; detalhe?: { finalizadoras?: Array<{ operacao: string }> } } }).envelope;
      if (env?.code !== 'FECHAMENTO_DOCUMENTOS_NAO_SELECIONADOS') throw e;
      const fz = (env.detalhe?.finalizadoras ?? []).map((x) => x.operacao);
      const texto = fz.length === 1
        ? `A finalizadora ${fz[0]} possui documentos que não foram selecionados.`
        : `As seguintes finalizadoras possuem documentos que não foram selecionados:\n${fz.join('\n')}`;
      if (!window.confirm(`${texto}\nDeseja continuar?`)) return;
      r = await efetivarTurno(ref, { ...corpo, confirmarDocumentosNaoSelecionados: true });
    }
    carregar(r);
    mensagem.sucesso('Fechamento realizado com sucesso.');
  });
  // REABRIR (btnReabrirClick): desfaz o fechamento — a contabilização, os títulos gerados, o caixa e a conta bancária
  const reabrir = () => executar(async () => {
    if (!ref || !det) return;
    if (!window.confirm('Confirma a reabertura do caixa? O fechamento, a contabilização e as contas geradas por ele serão desfeitos.')) return;
    const r = await reabrirTurno({ ...ref, situacao: undefined });
    setRef({ ...ref, situacao: 1 });
    carregar(r);
    mensagem.sucesso('Caixa reaberto com sucesso!');
  });
  // sair da finalização grava o rascunho, como o FormClose do legado
  const voltar = () => executar(async () => {
    await gravar();
    setDet(null);
    setRef(null);
    setTurnos(await listarTurnos(data));
  });

  const aConferirDocs = docs ? r2(docs.d.documentos.filter((x) => docs.marcados.has(x.codigo)).reduce((s, x) => s + x.valor, 0)) : 0;

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Fechamento de caixa" />

      {!det && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-44"><DateField label="&Data do caixa" value={data} onChange={(v) => setData(v ?? hoje())} /></div>
            <Button label="&Caixas do dia" variant="soft" onClick={() => void pesquisar()} disabled={ocupado} />
          </div>
          {turnos && (turnos.length === 0
            ? <small className="text-fg-muted">Nenhum movimento de PDV nesta data.</small>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-fg-muted">
                      <th className="px-2 py-1">PDV</th><th className="px-2 py-1">Operador(a)</th><th className="px-2 py-1">Entrada</th>
                      <th className="px-2 py-1">Saída</th><th className="px-2 py-1">Situação</th><th className="px-2 py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {turnos.map((t) => (
                      <tr key={`${t.nropdv}-${t.codoperadora}-${t.chave}-${t.situacao}`} className="border-t border-border">
                        <td className="px-2 py-1 tabular-nums">{t.nropdv}</td>
                        <td className="px-2 py-1">{t.codoperadora} — {t.nome ?? ''}</td>
                        <td className="px-2 py-1 tabular-nums" title={t.horaDaChave ? 'Hora tirada da chave do turno' : undefined}>{hora(t.horaentrada)}{t.horaDaChave ? '*' : ''}</td>
                        <td className="px-2 py-1 tabular-nums">{t.horasaida ? hora(t.horasaida) : <span className="text-fg-muted">não fechado no PDV</span>}</td>
                        <td className={`px-2 py-1 ${SITUACAO[t.situacao].cor}`}>{SITUACAO[t.situacao].rotulo}</td>
                        <td className="px-2 py-1 text-right">
                          <Button label={t.situacao === 1 ? 'Fechar caixa' : 'Consultar caixa'} variant="ghost" onClick={() => void abrir(t)} disabled={ocupado} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </section>
      )}

      {det && totais && (
        <>
          <section className="flex flex-wrap items-center justify-between gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-col">
              <strong>{consulta ? 'Consulta do fechamento de caixa' : 'Conferência do caixa'}</strong>
              <small className="text-fg-muted">
                Operador(a) {det.turno.codoperadora} — {det.turno.nome ?? ''} · PDV {det.turno.nropdv} · {det.turno.data.split('-').reverse().join('/')}
                {det.completadas ? ` · ${det.completadas} modalidade(s) incluída(s) zerada(s)` : ''}
              </small>
            </div>
            <div className="flex flex-wrap gap-gp-sm">
              {!consulta && <Button label="&Gravar conferência" variant="soft" onClick={() => void salvar()} disabled={ocupado} />}
              {!consulta && <Button label="&Efetivar fechamento" onClick={() => void efetivar()} disabled={ocupado} />}
              {consulta && det.turno.situacao === 3 && <Button label="&Reabrir caixa" variant="soft" onClick={() => void reabrir()} disabled={ocupado} />}
              <Button label="&Voltar" variant="soft" onClick={() => void voltar()} disabled={ocupado} />
            </div>
          </section>

          {avisos.length > 0 && (
            <section className="flex flex-col gap-gp-xs rounded-radius-md border border-border bg-bg-surface p-pad-md" role="status">
              <strong className="text-fg-danger">A contabilização deste fechamento ficou pendente — o TRON (fechamento de caixa) contabiliza depois.</strong>
              {avisos.map((a) => <small key={a} className="text-fg-muted">{a}</small>)}
            </section>
          )}

          <section className="grid grid-cols-1 gap-gp-sm sm:grid-cols-3">
            <div className="rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <small className="text-fg-muted">Total do fechamento (sistema + adicionais)</small>
              <div className="text-body-lg tabular-nums">{moeda(det.totais.fechamento)}</div>
            </div>
            <div className="rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <small className="text-fg-muted">Total conferido</small>
              <div className="text-body-lg tabular-nums">{moeda(totais.real)}</div>
            </div>
            <div className="rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <small className="text-fg-muted">Diferença</small>
              <div className={`text-body-lg tabular-nums ${totais.diferenca < 0 ? 'text-fg-danger' : totais.diferenca > 0 ? 'text-fg-success' : ''}`}>{moeda(totais.diferenca)}</div>
            </div>
          </section>

          <section className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className="px-2 py-1">Operação</th><th className="px-2 py-1 text-right">Valor bruto</th><th className="px-2 py-1 text-right">Troco</th>
                  <th className="px-2 py-1 text-right">Sistema</th><th className="px-2 py-1 text-right">Real</th><th className="px-2 py-1 text-right">Saldo</th><th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {det.linhas.map((l) => {
                  const real = realDe(l);
                  const saldo = r2(real - Math.abs(l.valor));
                  const temDocs = l.tipo && l.tipo !== 'DINHEIRO';
                  return (
                    <tr key={l.operacao} className="border-t border-border">
                      <td className="px-2 py-1">{l.operacao}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{moeda(l.valorb)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{moeda(l.troco)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{moeda(l.valor)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{moeda(real)}</td>
                      <td className={`px-2 py-1 text-right tabular-nums ${saldo < 0 ? 'text-fg-danger' : ''}`}>{moeda(saldo)}</td>
                      <td className="px-2 py-1 text-right">
                        {temDocs && <Button label="Documentos" variant="ghost" onClick={() => void verDocumentos(l.operacao, l.valor)} disabled={ocupado} />}
                        {l.linhaDinheiro && <small className="text-fg-muted">contado + sangria − suprimento</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="grid grid-cols-1 gap-gp-md rounded-radius-md border border-border bg-bg-surface p-pad-md md:grid-cols-2">
            <div className="flex flex-col gap-gp-xs">
              <strong className="text-body-sm">Dinheiro, sangrias e suprimento</strong>
              <div className="w-48">
                <Field label="Dinheiro &contado" inputMode="decimal" value={contado} disabled={consulta || !det.contadoHabilitado}
                  onChange={(e) => setContado(e.target.value.replace(/[^\d.,-]/g, ''))} />
              </div>
              {FIXAS.map((fx) => (
                <div key={fx} className="flex items-center justify-between gap-gp-sm">
                  <span>{fx.charAt(0) + fx.slice(1).toLowerCase()}</span>
                  <span className="flex items-center gap-gp-xs tabular-nums">
                    {moeda(det.fixas[fx])}
                    <Button label="Ver" variant="ghost" onClick={() => void verDocumentos(fx, det.fixas[fx])} disabled={ocupado} />
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-gp-xs">
              <strong className="text-body-sm">Adicionais e informativos</strong>
              {!consulta && (
                <CheckboxField
                  label={`Gerar &saldo do operador (título da quebra)${saldoAutomatico ? ' — marcado: a diferença passa do limite' : ''}`}
                  value={gerarSaldo || saldoAutomatico ? 'S' : 'N'}
                  onChange={(v) => setGerarSaldo(v === 'S')}
                />
              )}
              {([
                ['Recarga', det.adicionais.recarga], ['Correspondente', det.adicionais.correspondente],
                ['Voucher', det.adicionais.voucher], ['Troco solidário', det.adicionais.trocoSolidario],
                ['Venda líquida do operador', det.totais.valor], ['Cancelamentos', det.cancelamentos], ['Descontos nas vendas', det.descontos],
              ] as Array<[string, number]>).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-gp-sm"><span>{k}</span><span className="tabular-nums">{moeda(v)}</span></div>
              ))}
            </div>
          </section>
        </>
      )}

      {docs && (
        <Modal
          open
          onClose={confirmarDocs}
          size="lg"
          title={`Documentos — ${docs.d.operacao}`}
          primaryAction={{ label: 'Confirmar', onClick: confirmarDocs }}
          secondaryAction={docs.d.marcacaoLivre ? { label: 'Marcar/desmarcar todos (T)', onClick: marcarTodos } : undefined}
        >
          <div
            className="flex flex-col gap-gp-sm"
            onKeyDown={(e) => { if ((e.key === 't' || e.key === 'T') && !(e.target instanceof HTMLInputElement && e.target.type !== 'checkbox')) { e.preventDefault(); marcarTodos(); } }}
          >
            <small>
              A conferir <strong className="tabular-nums">{moeda(docs.aConferir)}</strong> · Conferido <strong className="tabular-nums">{moeda(aConferirDocs)}</strong>
              {' '}· {docs.marcados.size} de {docs.d.documentos.length} documento(s)
            </small>
            {edicao && (
              <section className="flex flex-col gap-gp-sm rounded-md border border-border p-3">
                <strong className="text-sm">
                  Editar documento {edicao.doc.codigo}{edicao.doc.nrocupom ? ` · cupom ${String(edicao.doc.nrocupom)}` : ''}
                  {docs.d.edicao === 'operadora' && <small className="font-normal text-fg-muted"> — turno fechado no PDV: só a operadora</small>}
                </strong>
                {docs.d.tipo === 'CARTAO' ? (
                  <div className="grid grid-cols-2 gap-gp-sm md:grid-cols-4">
                    <Field label="Valor" inputMode="decimal" disabled={docs.d.edicao === 'operadora'} {...campo('valor')} />
                    <div className="col-span-2">
                      <SelectField
                        label="Operadora"
                        value={edicao.f.codoperadora}
                        onChange={(v) => setEdicao((s) => (s ? { ...s, f: { ...s.f, codoperadora: v } } : s))}
                        options={operadoras.map((o) => ({ value: String(o.codoperadoras), label: `${o.codoperadoras} · ${o.operadora}` }))}
                      />
                    </div>
                    <Field label="Parcelas" inputMode="numeric" disabled={docs.d.edicao === 'operadora'} {...campo('nroparcela')} />
                    <Field label="NSU" maxLength={10} disabled={docs.d.edicao === 'operadora'} {...campo('nsu')} />
                    <Field label="NSU host" maxLength={30} disabled={docs.d.edicao === 'operadora'} {...campo('nsuhost')} />
                    <Field label="Autorização" maxLength={30} disabled={docs.d.edicao === 'operadora'} {...campo('autorizacao')} />
                    <Field label="Rede" inputMode="numeric" disabled={docs.d.edicao === 'operadora'} {...campo('codrede')} />
                    <div className="col-span-2 md:col-span-4"><Field label="Observação" disabled={docs.d.edicao === 'operadora'} {...campo('obs')} /></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-gp-sm md:grid-cols-4">
                    <Field label="Valor" inputMode="decimal" {...campo('valor')} />
                    <DateField label="Vencimento" value={edicao.f.dtvenc} onChange={(v) => setEdicao((s) => (s ? { ...s, f: { ...s.f, dtvenc: v ?? '' } } : s))} />
                    <Field label="Cliente (código)" inputMode="numeric" {...campo('codparceiro')} />
                    <div className="col-span-2 md:col-span-4"><Field label="Observação" {...campo('obs')} /></div>
                  </div>
                )}
                <div className="flex justify-end gap-gp-sm">
                  <Button label="Cancelar" variant="ghost" onClick={() => setEdicao(null)} disabled={ocupado} />
                  <Button label="Gravar" onClick={gravarEdicao} disabled={ocupado} />
                </div>
              </section>
            )}
            {docs.d.documentos.length === 0
              ? <small className="text-fg-muted">Nenhum documento para esta operação.</small>
              : (
                <div className="max-h-96 overflow-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <tbody>
                      {docs.d.documentos.map((x) => (
                        <tr key={x.codigo} className="border-t border-border">
                          <td className="px-2 py-1">
                            <CheckboxField
                              label={`${x.codigo} · ${String(x.nropedido ?? x.nrocupom ?? x.descricao ?? x.nrocheque ?? '')}${x.razao ? ` · ${String(x.razao)}` : ''}${x.operadora ? ` · ${String(x.operadora)}` : ''}`}
                              value={docs.marcados.has(x.codigo) ? 'S' : 'N'}
                              onChange={() => alternar(x.codigo)}
                            />
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{moeda(x.valor)}</td>
                          {docs.d.edicao && (
                            <td className="px-2 py-1 text-right">
                              <Button label="Editar" variant="ghost" onClick={() => editar(x)} disabled={ocupado} />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </Modal>
      )}
    </div>
  );
}
