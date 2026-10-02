import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, PageHeader } from '@apollosg/design-system';
import { DateField } from '../../shared/ui/DateField';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { TextArea } from '../../shared/ui/TextArea';
import { SelectField } from '../../shared/ui/SelectField';
import { listarOperadoras, type Operadora } from '../cartao/cartaoApi';
import { imprimirPagina } from '../../shared/print/imprimirPagina';
import { imprimirRelatorioFechamento } from './imprimirFechamento';
import { imprimirRelatorio as imprimirFr3 } from '../../shared/fr3/imprimirRelatorio';
import { LancamentoProvisorioModal } from './LancamentoProvisorioModal';
import { useMensagem } from '../../shared/mensagem';
import {
  abrirTurno, cancelamentosTurno, descontosTurno, detalheTurno, documentosTurno, editarDocumento, efetivarTurno, excluirDocumento, gravarObservacaoTurno, inserirDocumento, listarTurnos, observacaoTurno, reabrirTurno, relatorioFechamento, rotaImpressaoTurno, salvarRascunho,
  type CamposDocumento, type CancelamentosTurno, type DescontoTurno, type DetalheTurno, type DocumentoConferencia, type Documentos, type Fixa, type LinhaFechamento, type TurnoRef, type TurnoResumo,
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
interface Edicao { doc: DocumentoConferencia | null; f: Record<keyof CamposDocumento, string>; login: string; senha: string }
interface Exclusao { doc: DocumentoConferencia; login: string; senha: string }
const txt = (v: unknown) => (v == null ? '' : String(v));

export function FechamentoCaixaPage() {
  const mensagem = useMensagem();
  const navigate = useNavigate();
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
  const [exclusao, setExclusao] = useState<Exclusao | null>(null);
  // os diálogos de leitura da finalização: cancelamentos (Enter no campo) e vendas com descontos (F6)
  const [lancProv, setLancProv] = useState(false);
  // "Selecionar caixas para relatório" (Caixas em aberto): os turnos marcados para o relatório de fechamento
  const [marcadosRel, setMarcadosRel] = useState<Set<string>>(new Set());
  // F5 dos caixas em aberto: a observação de divergência (CAIXA_OBS) do PDV × operador × dia
  const [obsTurno, setObsTurno] = useState<{ t: TurnoRef; texto: string } | null>(null);
  const [leitura, setLeitura] = useState<{ tipo: 'cancelamentos'; d: CancelamentosTurno } | { tipo: 'descontos'; d: DescontoTurno[] } | null>(null);
  const [operadoras, setOperadoras] = useState<Operadora[]>([]);
  useEffect(() => {
    if (docs?.d.tipo === 'CARTAO' && (docs.d.edicao || docs.d.insercao) && operadoras.length === 0) listarOperadoras().then(setOperadoras).catch(() => undefined);
  }, [docs, operadoras.length]);

  const executar = async (f: () => Promise<void>) => {
    setOcupado(true);
    try { await f(); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const pesquisar = () => executar(async () => { setMarcadosRel(new Set()); setTurnos(await listarTurnos(data)); });

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
  const editar = (x: DocumentoConferencia) => { setExclusao(null); setEdicao({
    doc: x,
    f: {
      valor: txt(x.valor), codoperadora: txt(x.codoperadora), nsu: txt(x.nsu), nsuhost: txt(x.nsuhost), autorizacao: txt(x.autorizacao),
      codrede: txt(x.codrede), nroparcela: txt(x.nroparcela), obs: txt(x.obs), dtvenc: txt(x.dtvenc), codparceiro: txt(x.codparceiro),
      nrocupom: txt(x.nrocupom), nropedido: txt(x.nropedido), idpgto: '', descricao: '',
    },
    login: '', senha: '',
  }); };
  // INSERIR (Insert do legado): o A Receber nasce do consumidor (0), vencendo no dia do caixa; o cartão com 1 parcela
  const inserir = () => { setExclusao(null); setEdicao({
    doc: null,
    f: {
      valor: '', codoperadora: '', nsu: '', nsuhost: '', autorizacao: '', codrede: '', nroparcela: '1', obs: '',
      dtvenc: ref?.data ?? '', codparceiro: '0', nrocupom: '', nropedido: '',
      idpgto: txt(docs?.d.formasSangria?.[0]?.idpgto), descricao: '',
    },
    login: '', senha: '',
  }); };
  // EXCLUIR (Del do legado): confirma e, com liberadores configurados, pede o login de um deles
  const excluir = () => executar(async () => {
    if (!ref || !docs || !exclusao) return;
    if (docs.d.liberacaoExclusao && (!exclusao.login || !exclusao.senha)) { mensagem.erro(new Error('Informe o usuário e a senha de quem libera a exclusão.')); return; }
    await excluirDocumento(ref, docs.d.operacao, exclusao.doc.codigo, docs.d.liberacaoExclusao ? { login: exclusao.login, senha: exclusao.senha } : undefined);
    const d = await documentosTurno(ref, docs.d.operacao);
    const cod = exclusao.doc.codigo;
    setDocs((s) => (s ? { ...s, d, marcados: new Set([...s.marcados].filter((c) => c !== cod)) } : s));
    setExclusao(null);
    // a sangria muda o total da linha fixa (e o dinheiro); na consulta o REAL vem do banco — recarrega o turno sem perder a conferência
    if (consulta || docs.d.tipo === 'SANGRIA') setDet(await detalheTurno(ref));
    mensagem.sucesso('Documento excluído.');
  });
  const campo = (k: keyof CamposDocumento) => ({
    value: edicao?.f[k] ?? '',
    onChange: (e: { target: { value: string } }) => setEdicao((s) => (s ? { ...s, f: { ...s.f, [k]: e.target.value } } : s)),
  });
  const gravarEdicao = () => executar(async () => {
    if (!ref || !docs || !edicao) return;
    const f = edicao.f;
    const n = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));
    if (docs.d.tipo === 'SANGRIA') {
      if (!edicao.login || !edicao.senha) { mensagem.erro(new Error('Informe o usuário e a senha de quem libera a sangria/suprimento.')); return; }
      await inserirDocumento(ref, docs.d.operacao, { valor: n(f.valor), idpgto: n(f.idpgto), descricao: f.descricao }, { login: edicao.login, senha: edicao.senha });
      const d = await documentosTurno(ref, docs.d.operacao);
      setDocs((s) => (s ? { ...s, d, marcados: new Set(d.documentos.map((x) => x.codigo)) } : s));
      setEdicao(null);
      setDet(await detalheTurno(ref));
      mensagem.sucesso('Lançamento incluído.');
      return;
    }
    const campos: CamposDocumento = docs.d.tipo === 'CARTAO'
      ? docs.d.edicao === 'operadora'
        ? { codoperadora: n(f.codoperadora) }
        : { valor: n(f.valor), codoperadora: n(f.codoperadora), nsu: f.nsu, nsuhost: f.nsuhost, autorizacao: f.autorizacao, codrede: n(f.codrede), nroparcela: n(f.nroparcela), obs: f.obs }
      : { valor: n(f.valor), dtvenc: f.dtvenc || undefined, codparceiro: n(f.codparceiro), obs: f.obs };
    if (edicao.doc) await editarDocumento(ref, docs.d.operacao, edicao.doc.codigo, campos);
    else await inserirDocumento(ref, docs.d.operacao, docs.d.tipo === 'CARTAO' ? { ...campos, nrocupom: f.nrocupom, nropedido: f.nropedido } : campos);
    const d = await documentosTurno(ref, docs.d.operacao);
    setDocs((s) => (s ? { ...s, d } : s));
    setEdicao(null);
    // na consulta o REAL vem do banco: recarrega o turno para refletir o valor novo
    if (consulta) setDet(await detalheTurno(ref));
    mensagem.sucesso(edicao.doc ? 'Documento alterado.' : 'Documento incluído.');
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
  const verCancelamentos = () => executar(async () => { if (ref) setLeitura({ tipo: 'cancelamentos', d: await cancelamentosTurno(ref) }); });
  const verDescontos = () => executar(async () => {
    if (!ref) return;
    const d = await descontosTurno(ref);
    if (!d.length) { mensagem.erro(new Error('Não foram encontrados descontos nas vendas.')); return; }
    setLeitura({ tipo: 'descontos', d });
  });
  // clique na chave (o rótulo do legado): copia para a área de transferência
  const copiarChave = () => {
    if (!det?.turno.chave) return;
    void navigator.clipboard?.writeText(det.turno.chave).then(() => mensagem.sucesso('Chave copiada!')).catch(() => undefined);
  };

  // IMPRIMIR (o menu do legado): a janela abre no clique e o dado chega depois (popup-blocker)
  const imprimirComDado = async (carregarDado: (win: Window) => Promise<boolean>) => {
    const win = window.open('', '_blank');
    if (!win) { mensagem.erro(new Error('O navegador bloqueou a janela de impressão.')); return; }
    try { if (!(await carregarDado(win))) win.close(); } catch (e) { win.close(); mensagem.erro(e); }
  };
  // comprovante de quebra e histórico no layout .fr3 do cliente (a API devolve a mensagem do legado quando não há linha)
  const imprimirQuebra = () => { if (ref) imprimirFr3(rotaImpressaoTurno('quebra', ref)).catch((e) => mensagem.erro(e)); };
  const imprimirHist = () => { if (ref) imprimirFr3(rotaImpressaoTurno('historico', ref)).catch((e) => mensagem.erro(e)); };
  const abrirObs = (t: TurnoResumo) => executar(async () => {
    const r: TurnoRef = { data, chave: t.chave, nropdv: t.nropdv, codoperadora: t.codoperadora, situacao: t.situacao };
    setObsTurno({ t: r, texto: (await observacaoTurno(r)).obs ?? '' });
  });
  const gravarObs = () => executar(async () => {
    if (!obsTurno) return;
    await gravarObservacaoTurno(obsTurno.t, obsTurno.texto);
    setObsTurno(null);
    mensagem.sucesso('Observação gravada.');
  });

  // o relatório "Fechamento de caixa" (MontaRel): do turno aberto na tela ou dos marcados na lista
  const chaveTurno = (t: TurnoResumo) => `${t.nropdv}|${t.codoperadora}|${t.chave ?? ''}|${t.situacao}`;
  const imprimirRelatorio = (lista: Array<{ nropdv: number; codoperadora: number; chave: string | null }>) => void imprimirComDado(async (win) => {
    if (!lista.length) return false;
    imprimirRelatorioFechamento(win, await relatorioFechamento(ref?.data ?? data, lista));
    return true;
  });
  const imprimirMarcados = () => imprimirRelatorio((turnos ?? []).filter((t) => marcadosRel.has(chaveTurno(t))).map((t) => ({ nropdv: t.nropdv, codoperadora: t.codoperadora, chave: t.chave })));
  // o "Relatório de análise" (Totalizado/Descritivo) no layout do cliente: a grade do turno reordenada por operação
  const imprimirRelAnalise = (modo: 'totalizado' | 'descritivo') => {
    if (ref) imprimirFr3(rotaImpressaoTurno('analise', ref, { modo })).catch((e) => mensagem.erro(e));
  };

  // a lista do diálogo de documentos (fec_fechamento_de_caixa_doc_fin_*.fr3): imprime a grade como está
  const gradeDocs = useRef<HTMLDivElement>(null);
  const imprimirDocs = () => {
    if (!docs || !gradeDocs.current) return;
    if (!docs.d.documentos.length) { mensagem.erro(new Error('Não existem dados para gerar e imprimir o relatório.')); return; }
    const win = window.open('', '_blank');
    if (!win) { mensagem.erro(new Error('O navegador bloqueou a janela de impressão.')); return; }
    imprimirPagina(win, gradeDocs.current, `Documentos da finalizadora (${docs.d.operacao.toLowerCase()}) — ${ref?.data.split('-').reverse().join('/') ?? ''}`);
  };

  // sair da finalização grava o rascunho, como o FormClose do legado
  const voltar = () => executar(async () => {
    await gravar();
    setDet(null);
    setRef(null);
    setTurnos(await listarTurnos(data));
  });

  const rotuloIncluir = docs?.d.tipo !== 'SANGRIA' ? 'Incluir documento' : docs.d.operacao === 'SUPRIMENTO' ? 'Incluir suprimento' : 'Incluir sangria';
  const aConferirDocs = docs ? r2(docs.d.documentos.filter((x) => docs.marcados.has(x.codigo)).reduce((s, x) => s + x.valor, 0)) : 0;

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Fechamento de caixa" />

      {!det && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-44"><DateField label="&Data do caixa" value={data} onChange={(v) => setData(v ?? hoje())} /></div>
            <Button label="&Caixas do dia" variant="soft" onClick={() => void pesquisar()} disabled={ocupado} />
            {turnos && turnos.length > 0 && (
              <>
                <Button
                  label="Marcar/desmarcar &todos"
                  variant="ghost"
                  onClick={() => setMarcadosRel((m) => (m.size === turnos.length ? new Set() : new Set(turnos.map(chaveTurno))))}
                />
                <Button label="&Imprimir marcados" variant="ghost" onClick={imprimirMarcados} disabled={ocupado || marcadosRel.size === 0} />
              </>
            )}
            {/* F6 dos caixas em aberto: a transferência de espécie é a do controle de contas correntes (Utransferencia) */}
            <Button label="&Transferência" variant="ghost" onClick={() => navigate('/financeiro/contas-correntes')} />
            {/* Imprimir › "Relatório de caixa": só um atalho para a tela do relatório (FRMRELATORIOCAIXA, já migrada) */}
            <Button label="&Relatório de caixa" variant="ghost" onClick={() => navigate('/relatorios/caixa-dre')} />
          </div>
          {turnos && (turnos.length === 0
            ? <small className="text-fg-muted">Nenhum movimento de PDV nesta data.</small>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-fg-muted">
                      <th className="px-2 py-1">PDV</th><th className="px-2 py-1">Operador(a)</th><th className="px-2 py-1">Entrada</th>
                      <th className="px-2 py-1">Saída</th><th className="px-2 py-1">Situação</th><th className="px-2 py-1">Relatório</th><th className="px-2 py-1" />
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
                        <td className="px-2 py-1">
                          <CheckboxField
                            label="Marcar"
                            value={marcadosRel.has(chaveTurno(t)) ? 'S' : 'N'}
                            onChange={() => setMarcadosRel((m) => { const n2 = new Set(m); const k = chaveTurno(t); if (n2.has(k)) n2.delete(k); else n2.add(k); return n2; })}
                          />
                        </td>
                        <td className="px-2 py-1 text-right">
                          <Button label="Obs." variant="ghost" onClick={() => void abrirObs(t)} disabled={ocupado} />
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
                {det.turno.chave && (
                  <> · chave <button type="button" className="tabular-nums underline" title="Copiar a chave" onClick={copiarChave}>{det.turno.chave}</button></>
                )}
                {det.completadas ? ` · ${det.completadas} modalidade(s) incluída(s) zerada(s)` : ''}
                {det.pdvNaoFechado && <strong className="text-fg-danger"> · O caixa selecionado ainda não foi fechado no PDV.</strong>}
              </small>
            </div>
            <div className="flex flex-wrap gap-gp-sm">
              {!consulta && <Button label="&Gravar conferência" variant="soft" onClick={() => void salvar()} disabled={ocupado} />}
              {!consulta && <Button label="&Efetivar fechamento" onClick={() => void efetivar()} disabled={ocupado || !!det.pdvNaoFechado} />}
              {consulta && det.turno.situacao === 3 && <Button label="&Reabrir caixa" variant="soft" onClick={() => void reabrir()} disabled={ocupado} />}
              {!consulta && <Button label="&Lançamento provisório" variant="ghost" onClick={() => setLancProv(true)} disabled={ocupado} />}
              <Button label="Relatório de &fechamento" variant="ghost" onClick={() => imprimirRelatorio([{ nropdv: det.turno.nropdv, codoperadora: det.turno.codoperadora, chave: det.turno.chave }])} disabled={ocupado} />
              <Button label="Análise totalizada" variant="ghost" onClick={() => imprimirRelAnalise('totalizado')} disabled={ocupado} />
              <Button label="Análise descritiva" variant="ghost" onClick={() => imprimirRelAnalise('descritivo')} disabled={ocupado} />
              <Button label="Comprovante de &quebra" variant="ghost" onClick={imprimirQuebra} disabled={ocupado} />
              <Button label="&Histórico" variant="ghost" onClick={imprimirHist} disabled={ocupado} />
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
                <div key={k} className="flex items-center justify-between gap-gp-sm">
                  <span>
                    {k}
                    {k === 'Cancelamentos' && <> <Button label="Ver" variant="ghost" onClick={() => void verCancelamentos()} disabled={ocupado} /></>}
                    {k === 'Descontos nas vendas' && <> <Button label="Ver" variant="ghost" onClick={() => void verDescontos()} disabled={ocupado} /></>}
                  </span>
                  <span className="tabular-nums">{moeda(v)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {obsTurno && (
        <Modal
          open
          onClose={() => setObsTurno(null)}
          title={`Observação de divergência — PDV ${obsTurno.t.nropdv}, operador(a) ${obsTurno.t.codoperadora}`}
          primaryAction={{ label: 'OK', onClick: () => void gravarObs() }}
          secondaryAction={{ label: 'Sair', onClick: () => setObsTurno(null) }}
        >
          <TextArea label="Observação" rows={6} value={obsTurno.texto} onChange={(e) => setObsTurno((s) => (s ? { ...s, texto: e.target.value } : s))} />
        </Modal>
      )}

      {lancProv && ref && (
        <LancamentoProvisorioModal
          turno={ref}
          onClose={() => setLancProv(false)}
          onAlterou={() => void executar(async () => { setDet(await detalheTurno(ref)); })}
        />
      )}

      {leitura && (
        <Modal
          open
          onClose={() => setLeitura(null)}
          size="lg"
          title={leitura.tipo === 'cancelamentos' ? 'Vendas canceladas' : 'Vendas com descontos'}
          primaryAction={{ label: 'Sair', onClick: () => setLeitura(null) }}
        >
          {leitura.tipo === 'cancelamentos' ? (
            <div className="flex flex-col gap-gp-sm">
              <strong className="text-sm">Cupons cancelados</strong>
              {leitura.d.cupons.length === 0 ? <small className="text-fg-muted">Nenhum cupom cancelado.</small> : (
                <div className="max-h-64 overflow-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-fg-muted"><th className="px-2 py-1">Cupom</th><th className="px-2 py-1">PDV</th><th className="px-2 py-1 text-right">Qtde</th><th className="px-2 py-1 text-right">Total</th><th className="px-2 py-1">Motivo</th><th className="px-2 py-1">Responsável</th></tr></thead>
                    <tbody>
                      {leitura.d.cupons.map((x) => (
                        <tr key={x.nropedido} className="border-t border-border">
                          <td className="px-2 py-1 tabular-nums">{x.nrocupom}</td><td className="px-2 py-1 tabular-nums">{x.pdv}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{x.qtde.toLocaleString('pt-BR')}</td><td className="px-2 py-1 text-right tabular-nums">{moeda(x.total)}</td>
                          <td className="px-2 py-1">{x.motivo ?? ''}</td><td className="px-2 py-1">{x.responsavel ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <strong className="text-sm">Itens cancelados</strong>
              {leitura.d.itens.length === 0 ? <small className="text-fg-muted">Nenhum item cancelado.</small> : (
                <div className="max-h-64 overflow-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-fg-muted"><th className="px-2 py-1">Cupom</th><th className="px-2 py-1">Item</th><th className="px-2 py-1">Produto</th><th className="px-2 py-1 text-right">Qtde</th><th className="px-2 py-1 text-right">Total</th><th className="px-2 py-1">Motivo</th><th className="px-2 py-1">Responsável</th></tr></thead>
                    <tbody>
                      {leitura.d.itens.map((x) => (
                        <tr key={`${x.nrocupom}-${x.nroitem}`} className="border-t border-border">
                          <td className="px-2 py-1 tabular-nums">{x.nrocupom}</td><td className="px-2 py-1 tabular-nums">{x.nroitem}</td>
                          <td className="px-2 py-1">{x.codbarra ?? x.codproduto} · {x.descricao ?? ''}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{x.qtde.toLocaleString('pt-BR')}</td><td className="px-2 py-1 text-right tabular-nums">{moeda(x.total)}</td>
                          <td className="px-2 py-1">{x.motivo ?? ''}</td><td className="px-2 py-1">{x.responsavel ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="max-h-96 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-fg-muted"><th className="px-2 py-1">Nro. Cupom</th><th className="px-2 py-1">Código de barras</th><th className="px-2 py-1">Descrição</th><th className="px-2 py-1 text-right">Desconto</th><th className="px-2 py-1">Responsável</th><th className="px-2 py-1">Motivo</th></tr></thead>
                <tbody>
                  {leitura.d.map((x, i) => (
                    <tr key={`${x.nrocupom}-${x.codproduto}-${i}`} className="border-t border-border">
                      <td className="px-2 py-1 tabular-nums">{x.nrocupom}</td><td className="px-2 py-1 tabular-nums">{x.codbarra ?? ''}</td><td className="px-2 py-1">{x.descricao ?? ''}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{moeda(x.desconto)}</td><td className="px-2 py-1">{x.responsavel ?? ''}</td><td className="px-2 py-1">{x.motivo ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
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
                  {edicao.doc
                    ? <>Editar documento {edicao.doc.codigo}{edicao.doc.nrocupom ? ` · cupom ${String(edicao.doc.nrocupom)}` : ''}</>
                    : <>{rotuloIncluir}</>}
                  {edicao.doc && docs.d.edicao === 'operadora' && <small className="font-normal text-fg-muted"> — turno fechado no PDV: só a operadora</small>}
                </strong>
                {docs.d.tipo === 'SANGRIA' ? (
                  <div className="grid grid-cols-2 gap-gp-sm md:grid-cols-4">
                    {(docs.d.formasSangria?.length ?? 0) > 0 && (
                      <div className="col-span-2">
                        <SelectField
                          label="Forma da sangria"
                          value={edicao.f.idpgto}
                          onChange={(v) => setEdicao((s) => (s ? { ...s, f: { ...s.f, idpgto: v } } : s))}
                          options={(docs.d.formasSangria ?? []).map((fp) => ({ value: String(fp.idpgto), label: fp.modalidade }))}
                        />
                      </div>
                    )}
                    <Field label="Valor" inputMode="decimal" {...campo('valor')} />
                    <div className="col-span-2 md:col-span-4"><Field label="Descrição" maxLength={100} {...campo('descricao')} /></div>
                    <Field label="Usuário que libera" value={edicao.login} onChange={(e) => setEdicao((s) => (s ? { ...s, login: e.target.value } : s))} />
                    <Field label="Senha" type="password" value={edicao.senha} onChange={(e) => setEdicao((s) => (s ? { ...s, senha: e.target.value } : s))} />
                  </div>
                ) : docs.d.tipo === 'CARTAO' ? (
                  <div className="grid grid-cols-2 gap-gp-sm md:grid-cols-4">
                    <Field label="Valor" inputMode="decimal" disabled={!!edicao.doc && docs.d.edicao === 'operadora'} {...campo('valor')} />
                    <div className="col-span-2">
                      <SelectField
                        label="Operadora"
                        value={edicao.f.codoperadora}
                        onChange={(v) => setEdicao((s) => (s ? { ...s, f: { ...s.f, codoperadora: v } } : s))}
                        options={operadoras.map((o) => ({ value: String(o.codoperadoras), label: `${o.codoperadoras} · ${o.operadora}` }))}
                      />
                    </div>
                    <Field label="Parcelas" inputMode="numeric" disabled={!!edicao.doc && docs.d.edicao === 'operadora'} {...campo('nroparcela')} />
                    <Field label="NSU" maxLength={10} disabled={!!edicao.doc && docs.d.edicao === 'operadora'} {...campo('nsu')} />
                    <Field label="NSU host" maxLength={30} disabled={!!edicao.doc && docs.d.edicao === 'operadora'} {...campo('nsuhost')} />
                    <Field label="Autorização" maxLength={30} disabled={!!edicao.doc && docs.d.edicao === 'operadora'} {...campo('autorizacao')} />
                    <Field label="Rede" inputMode="numeric" disabled={!!edicao.doc && docs.d.edicao === 'operadora'} {...campo('codrede')} />
                    {!edicao.doc && <Field label="Cupom" maxLength={20} {...campo('nrocupom')} />}
                    {!edicao.doc && <Field label="Pedido" maxLength={20} {...campo('nropedido')} />}
                    <div className="col-span-2 md:col-span-4"><Field label="Observação" disabled={!!edicao.doc && docs.d.edicao === 'operadora'} {...campo('obs')} /></div>
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
            {exclusao && (
              <section className="flex flex-col gap-gp-sm rounded-md border border-border p-3">
                <strong className="text-sm">
                  Deseja realmente excluir o documento {exclusao.doc.codigo}{exclusao.doc.nrocupom ? ` (cupom ${String(exclusao.doc.nrocupom)})` : ''} de {moeda(exclusao.doc.valor)}?
                </strong>
                {docs.d.liberacaoExclusao && (
                  <div className="grid grid-cols-2 gap-gp-sm">
                    <Field label="Usuário que libera" value={exclusao.login} onChange={(e) => setExclusao((s) => (s ? { ...s, login: e.target.value } : s))} />
                    <Field label="Senha" type="password" value={exclusao.senha} onChange={(e) => setExclusao((s) => (s ? { ...s, senha: e.target.value } : s))} />
                  </div>
                )}
                <div className="flex justify-end gap-gp-sm">
                  <Button label="Cancelar" variant="ghost" onClick={() => setExclusao(null)} disabled={ocupado} />
                  <Button label="Excluir" onClick={excluir} disabled={ocupado} />
                </div>
              </section>
            )}
            <div className="flex justify-end gap-gp-sm">
              <Button label="Imprimir" variant="ghost" onClick={imprimirDocs} disabled={ocupado} />
              {docs.d.insercao && !edicao && <Button label={rotuloIncluir} variant="outline" onClick={inserir} disabled={ocupado} />}
            </div>
            {docs.d.documentos.length === 0
              ? <small className="text-fg-muted">Nenhum documento para esta operação.</small>
              : (
                <div ref={gradeDocs} className="max-h-96 overflow-auto rounded-md border border-border">
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
                          {(docs.d.edicao || docs.d.exclusao) && (
                            <td className="px-2 py-1 text-right">
                              <div className="flex justify-end gap-gp-xs">
                                {docs.d.edicao && <Button label="Editar" variant="ghost" onClick={() => editar(x)} disabled={ocupado} />}
                                {docs.d.exclusao && (
                                  <Button label="Excluir" variant="ghost" onClick={() => { setEdicao(null); setExclusao({ doc: x, login: '', senha: '' }); }} disabled={ocupado} />
                                )}
                              </div>
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
