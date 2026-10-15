import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { areceberSchema, AR_TIPODOC_OPCOES, planejarParcelasAreceber, ErroPlanoParcelas, type CriarAreceberDto, type ParcelaAreceberPlanejada } from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { DateField } from '../../shared/ui/DateField';
import { TextArea } from '../../shared/ui/TextArea';
import { Button } from '../../shared/ui/Button';
import { Tabs, TabPanel, type TabDef } from '../../shared/ui/Tabs';
import { type Opcao } from '../../shared/cadmaster/useResourceOptions';
import { LookupField } from '../../shared/ui/LookupField';
import { useSituacoesDaOperacao, useSituacaoUnica } from '../../shared/situacao/situacaoDaOperacao';
import { useMensagem } from '../../shared/mensagem';
import { hojeNaLoja } from '../../shared/tempo';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';
import { adicionarAoAgrupamento, membrosAgrupamento, removerDoAgrupamento, reverterAgrupamento } from '../agrupamento/agrupamentoApi';
import { nfsDaConta, parcelasAreceber, regerarParcelasAreceber, type NfDaConta, type ParcelaAreceber } from './areceberApi';

const hojeISO = () => hojeNaLoja();
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const fmtData = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s;
};
/** as mensagens do "&Parcelas" (btnGeraParcelasClick) para a prévia feita na tela */
const MSG_PLANO: Record<string, string> = {
  ARECEBER_TOTAL_OBRIGATORIO: 'Valor total das parcelas deve ser preenchido. Verifique!',
  ARECEBER_PARCELAS_LIMITE: 'O número de parcelas deve ser menor que 200.',
  APAGAR_PARCELAS_SEM_VENCIMENTO: 'Informe o vencimento da 1ª parcela.',
  PARCELA_VALOR_INSUFICIENTE: 'O valor total é insuficiente para o número de parcelas (cada parcela precisa de ao menos R$ 0,01).',
};
/** `DbtOrigem` (uCadAReceber.dfm:68) — o texto da origem do documento */
const ORIGEM_TEXTO: Record<string, string> = { A: 'Adiantamento', B: 'Baixa parcial', F: 'Faturamento', Q: 'Quebra de caixa', O: 'Convênio', C: 'Caixa' };
const th = 'py-1 pr-2 text-left font-semibold text-fg-muted';
const td = 'py-1 pr-2';
const tdNum = 'py-1 pr-2 text-right tabular-nums';

/**
 * CONTAS A RECEBER (uCadAReceber) — corte-1: cadastro/gestão do título, layout tabulado fiel ao
 * legado (abas Cadastro / Histórico / Pendências), visual do design system. Sobre o <CadMaster>
 * (contrato REST em `cadastro/areceber`). A BAIXA é o corte-2 (ARECEBER_BX). As TRAVAS de estado
 * (quitado/agrupado) desabilitam a edição; o título de outro processo trava só os campos que o servidor indica.
 */
export function ContasReceberCadMaster() {
  // só as situações da operação da tela (UCadSituacaoNF.md C5)
  const situacaoOptions = useSituacoesDaOperacao('F05', 'S');

  const defaultValues = useMemo<Partial<CriarAreceberDto>>(
    () => ({ dtvenda: hojeISO(), dtvenc: hojeISO(), nrodup: 1, tipodoc: 'DUPLICATA' }),
    [],
  );

  return (
    <CadMaster<CriarAreceberDto>
      titulo="Contas a Receber"
      resourcePath="cadastro/areceber"
      pk="codrcb"
      // a Pesquisa lê a GET_RCB do legado: o código que volta é o CODIGO (= codrcb)
      viewPk="codigo"
      log={{ form: 'FRMCADARECEBER', chave: 'CODRCB' }}
      schema={areceberSchema}
      defaultValues={defaultValues}
      largura="5xl"
      gerenciaEdicaoInterna
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'duplicata', label: 'Duplicata', tipo: 'text', largura: 140 },
        { campo: 'cliente', label: 'Cliente', tipo: 'text' },
        { campo: 'data_vencimento', label: 'Vencimento', tipo: 'date', largura: 130 },
        { campo: 'valor', label: 'Valor', tipo: 'text', largura: 120 },
        { campo: 'quitada', label: 'Quitada', tipo: 'text', largura: 90 },
      ]}
      campos={({ form, editavel, carregar }) => (
        <ArForm
          form={form}
          editavel={editavel}
          opts={{ situacaoOptions }}
          carregar={carregar}
        />
      )}
    />
  );
}

type LookupOptions = {
  situacaoOptions: Opcao[];
};

/** o centro de custo como o legado o mostra: o código extenso (DESCCODPLC) e a descrição */
const descPlc = (l: Record<string, any>) => `${l.desccodplc ?? l.codplc} - ${l.descricao ?? ''}`;

function ArForm({
  form,
  editavel,
  opts,
  carregar,
}: {
  form: UseFormReturn<CriarAreceberDto>;
  editavel: boolean;
  opts: LookupOptions;
  carregar?: (id: number) => Promise<void>;
}) {
  const [aba, setAba] = useState('cadastro');
  // como o legado (uCadAReceber): quitado/agrupado travam a tela; o de NF e o de ORIGEM Q/O/C travam só os campos que o servidor
  // devolve em campos_bloqueados (BLOQUEIA_CONTAS_RECEBER_ORIGEM_AUTO); contabilizado grava e refaz o contábil
  const g = form.getValues() as Record<string, unknown>;
  useSituacaoUnica(form, opts.situacaoOptions, g.codrcb == null); // a única F05 entra sozinha (uCadAReceber.pas:3110)
  const quitada = form.watch('quitada' as any) ?? g.quitada;
  const agrupado = form.watch('agrupado' as any) ?? g.agrupado;
  const contabilizado = g.contabilizado;
  const idnf = g.idnf;
  const travado = quitada === 'S' || agrupado === 'S';
  const liberado = editavel && !travado;
  const bloqueados = new Set(((g.campos_bloqueados as string[] | undefined) ?? []));

  const codrcb = g.codrcb as number | undefined;
  const opcoes = useOpcoesDoForm('FRMCADARECEBER');
  // as abas do uCadAReceber.dfm (pgcReceber): Cadastro (com a grade das parcelas e o "&Parcelas"), Histórico (= os agrupados:
  // Reverter/Adicionar/Remover título, Imprimir Analítico/Sintético/Extrato funcionário) e Pendências — esta sem substrato
  // (STATUS_PENDENCIA só 'C', 18 títulos, o último em 01/2024) e fora
  const tabs: TabDef[] = [
    { id: 'cadastro', label: 'Cadastro' },
    { id: 'parcelas', label: '&Parcelas' },
    { id: 'agrupados', label: 'A&grupados', disabled: codrcb == null },
  ];

  return (
    <div className="flex flex-col gap-form-gap">
      {travado && (
        <div className="rounded-radius-base border border-border bg-bg-subtle p-pad-sm text-fg-muted">
          Título {quitada === 'S' ? 'quitado' : 'agrupado'} — edição bloqueada.
        </div>
      )}
      {!travado && (bloqueados.size > 0 || contabilizado === 'S') && (
        <div className="rounded-radius-base border border-border bg-bg-subtle p-pad-sm text-fg-muted">
          {bloqueados.size > 0 && <>Conta gerada por outro processo{idnf != null ? ' (nota fiscal)' : ''}: os campos travados não se alteram aqui. </>}
          {contabilizado === 'S' && <>Conta contabilizada: ao gravar, o lançamento contábil é refeito.</>}
        </div>
      )}
      <EstadoBar form={form} />
      <OrigemLinha form={form} />
      <BaixaSection form={form} />
      <div>
        <Tabs tabs={tabs} active={aba} onChange={setAba} />
        <TabPanel>
          {aba === 'cadastro' && <CadastroTab form={form} editavel={liberado} opts={opts} bloqueados={bloqueados} podeMulta={opcoes.tem('EDTMULTA')} />}
          {aba === 'parcelas' && <ParcelasTab form={form} editavel={editavel} travado={travado || bloqueados.has('nrodup')} podeGravar={opcoes.tem('BTNGRAVAR')} carregar={carregar} />}
          {aba === 'agrupados' && codrcb != null && <AgrupadosTab form={form} carregar={carregar} />}
        </TabPanel>
      </div>
    </div>
  );
}

/** "Origem do documento:" (DbtOrigem/AbreTelaCorrespondente :489): a NF da conta, o adiantamento ou a venda do pedido */
function OrigemLinha({ form }: { form: UseFormReturn<CriarAreceberDto> }) {
  const navigate = useNavigate();
  const g = form.getValues() as Record<string, unknown>;
  if (g.codrcb == null) return null;
  const origem = String(g.origem ?? '').trim();
  const idnf = num(g.idnf);
  const nropedido = String(g.nropedido ?? g.nroped ?? '').trim();
  const abrir = () => {
    if (idnf > 0) navigate(`/fiscal/notas/saida?codigo=${idnf}`);
    else if (nropedido) navigate(`/vendas/historico?nropedido=${encodeURIComponent(nropedido)}&empresa=${String(g.codempresa ?? '')}`);
  };
  const temDestino = !['A', 'B', 'F', 'Q', 'O'].includes(origem) && (idnf > 0 || !!nropedido);
  if (!origem && !temDestino) return null;
  return (
    <div className="flex flex-wrap items-center gap-gp-sm text-body-sm">
      {origem && <span className="text-fg-muted">Origem do documento: <b className="text-fg-default">{ORIGEM_TEXTO[origem] ?? origem}</b></span>}
      {temDestino && <Button label={idnf > 0 ? `Abrir a nota fiscal ${String(g.nronf ?? idnf)}` : `Abrir a venda ${nropedido}`} variant="ghost" onClick={abrir} />}
    </div>
  );
}

/**
 * A aba PARCELAS: a grade `dbgParcelas` (o documento inteiro) e o "&Parcelas" (grbConfiguracao: Intervalo, Dia de Venc., Venc. 1ª parcela).
 * No documento novo a prévia é a da tela (o mesmo plano que a API grava) e o Gravar grava as N parcelas; no gravado, o botão refaz o grupo.
 * "Preservar dia de vencimento" e "Incluir restantes na última parcela" estão no dfm mas o fonte não os lê — ficam fora.
 */
function ParcelasTab({ form, editavel, travado, podeGravar, carregar }: {
  form: UseFormReturn<CriarAreceberDto>; editavel: boolean; travado: boolean; podeGravar: boolean; carregar?: (id: number) => Promise<void>;
}) {
  const mensagem = useMensagem();
  const g = form.getValues() as Record<string, unknown>;
  const codrcb = g.codrcb as number | undefined;
  const nrodup = Number(form.watch('nrodup' as any) ?? 1) || 1;
  const valor = Number(form.watch('valor' as any) ?? 0) || 0;
  const total = Number(form.watch('total' as any) ?? 0) || 0;
  void total;
  const dtvenc = String(form.watch('dtvenc' as any) ?? '');
  const geracao = (form.watch('geracao' as any) ?? {}) as { intervalo?: number; dia_fixo?: number };
  const [previa, setPrevia] = useState<ParcelaAreceberPlanejada[] | null>(null);
  const [dados, setDados] = useState<{ parcelas: ParcelaAreceber[]; totais: { nrodup: number; total_parcelas: number; total_documento: number } } | null>(null);
  const [cfg, setCfg] = useState<{ nrodup?: number; dtvenc?: string; intervalo?: number; dia_fixo?: number; total?: number }>({});
  const [processando, setProcessando] = useState(false);
  const setGeracao = (patch: Partial<typeof geracao>) => form.setValue('geracao' as any, { ...geracao, ...patch } as any, { shouldDirty: true });
  useEffect(() => {
    if (codrcb == null) { setDados(null); return; }
    parcelasAreceber(codrcb).then((d) => {
      setDados(d);
      setCfg({ nrodup: d.totais.nrodup, dtvenc: String(d.parcelas[0]?.dtvenc ?? '').slice(0, 10), total: d.totais.total_documento });
    }).catch((e) => mensagem.erro(e));
  }, [codrcb, mensagem]);
  useEffect(() => { setPrevia(null); }, [nrodup, valor, total, dtvenc, geracao.intervalo, geracao.dia_fixo]);
  const totalDoc = total > 0 ? total : valor * nrodup;
  const processarNovo = () => {
    try {
      setPrevia(planejarParcelasAreceber({ total: totalDoc, nrodup, venc1: dtvenc, intervalo: geracao.intervalo, diaFixo: geracao.dia_fixo, duplicata: g.duplicata as string | undefined, docnf: g.docnf as string | undefined }));
    } catch (e) {
      mensagem.erro(new Error(e instanceof ErroPlanoParcelas ? (MSG_PLANO[e.code] ?? e.code) : String((e as Error).message)));
    }
  };
  const processarGravado = async () => {
    if (codrcb == null) return;
    if (!cfg.dtvenc) { mensagem.erro(new Error(MSG_PLANO.APAGAR_PARCELAS_SEM_VENCIMENTO)); return; }
    if (!window.confirm('As parcelas atuais do documento serão substituídas. Deseja continuar?')) return;
    setProcessando(true);
    try {
      const r = await regerarParcelasAreceber(codrcb, { nrodup: cfg.nrodup ?? 1, dtvenc: cfg.dtvenc, total: cfg.total, intervalo: cfg.intervalo, dia_fixo: cfg.dia_fixo });
      mensagem.sucesso('Parcelas geradas.');
      await carregar?.(r.codrcbs[0]);
    } catch (e) { mensagem.erro(e); } finally { setProcessando(false); }
  };
  const novo = codrcb == null;
  const linhas: Array<Record<string, unknown>> = novo ? ((previa ?? []) as unknown as Array<Record<string, unknown>>) : (dados?.parcelas ?? []);
  return (
    <div className="flex flex-col gap-form-gap">
      <fieldset disabled={novo ? !editavel : (travado || !podeGravar)} className="rounded-radius-base border border-border p-pad-sm">
        <legend className="px-1 text-body-sm font-semibold text-fg-muted">Configuração</legend>
        <div className="grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-6">
          {novo ? (
            <>
              <NumberField label="&Intervalo (dias)" value={geracao.intervalo} onChange={(v) => setGeracao({ intervalo: v ?? undefined })} decimais={0} min={0} />
              <NumberField label="Dia de &Venc." value={geracao.dia_fixo} onChange={(v) => setGeracao({ dia_fixo: v ?? undefined })} decimais={0} min={1} />
              <div className="col-span-2 self-end text-body-sm text-fg-muted">Parcelas: {nrodup} · Venc. 1ª parcela {fmtData(dtvenc)} · valor total R$ {fmtBRL(totalDoc)}</div>
              <div className="self-end"><Button label="&Parcelas (prévia)" variant="soft" onClick={processarNovo} disabled={nrodup <= 1} /></div>
            </>
          ) : (
            <>
              <NumberField label="Parcelas" value={cfg.nrodup} onChange={(v) => setCfg({ ...cfg, nrodup: v ?? undefined })} decimais={0} min={1} />
              <NumberField label="&Intervalo (dias)" value={cfg.intervalo} onChange={(v) => setCfg({ ...cfg, intervalo: v ?? undefined })} decimais={0} min={0} />
              <NumberField label="Dia de &Venc." value={cfg.dia_fixo} onChange={(v) => setCfg({ ...cfg, dia_fixo: v ?? undefined })} decimais={0} min={1} />
              <DateField label="Venc. 1ª parcela" value={cfg.dtvenc || undefined} onChange={(v) => setCfg({ ...cfg, dtvenc: v ?? '' })} />
              <CurrencyField label="Valor total" value={cfg.total} onChange={(v) => setCfg({ ...cfg, total: v })} />
              <div className="self-end"><Button label="&Parcelas" variant="soft" onClick={processarGravado} disabled={processando} /></div>
            </>
          )}
        </div>
      </fieldset>
      {!novo && dados && (
        <div className="flex flex-wrap gap-gp-md text-body-sm">
          <span className="text-fg-muted">Parcelas: <b className="text-fg-default">{dados.totais.nrodup}</b></span>
          <span className="text-fg-muted">Total das parcelas: <b className="tabular-nums text-fg-default">R$ {fmtBRL(dados.totais.total_parcelas)}</b></span>
          <span className="text-fg-muted">Valor total do documento: <b className="tabular-nums text-fg-default">R$ {fmtBRL(dados.totais.total_documento)}</b></span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead><tr className="border-b border-border">
            <th className={th}>Código</th><th className={th}>Duplicata</th><th className={th}>Vencimento</th><th className={`${th} text-right`}>Valor</th><th className={th}>Cobrança</th><th className={th}>Forma</th><th className={th}>Quitada</th>
          </tr></thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={String(l.codrcb ?? i)} className={`border-b border-border ${!novo && carregar ? 'cursor-pointer hover:bg-bg-subtle' : ''}`}
                onClick={() => { if (!novo && l.codrcb != null && Number(l.codrcb) !== codrcb) void carregar?.(Number(l.codrcb)); }}>
                <td className={td}>{novo ? '—' : String(l.codrcb)}</td><td className={td}>{String(l.duplicata ?? '')}</td><td className={td}>{fmtData(l.dtvenc)}</td>
                <td className={tdNum}>{fmtBRL(num(l.valor))}</td><td className={td}>{novo ? String(g.tipodoc ?? '') : String(l.tipodoc ?? '')}</td>
                <td className={td}>{novo ? '' : String(l.modalidade ?? l.idpgto ?? '')}</td><td className={td}>{novo ? 'N' : String(l.quitada ?? 'N')}</td>
              </tr>
            ))}
            {!linhas.length && <tr><td className={`${td} text-fg-muted`} colSpan={7}>{novo ? 'Informe as parcelas e clique em "Parcelas" para ver a prévia.' : 'Sem parcelas.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** a aba HISTÓRICO/agrupados (tbsHistorico): os títulos agrupados, Reverter, Adicionar/Remover título, Imprimir (Analítico/Sintético/Extrato funcionário); no membro, o consolidado */
function AgrupadosTab({ form, carregar }: { form: UseFormReturn<CriarAreceberDto>; carregar?: (id: number) => Promise<void> }) {
  const mensagem = useMensagem();
  const navigate = useNavigate();
  const g = form.getValues() as Record<string, unknown>;
  const codrcb = g.codrcb as number;
  const consolidado = g.agrupamento === 'S';
  const emRcb = g.agrupado_em_rcb != null ? Number(g.agrupado_em_rcb) : null;
  const emApg = g.agrupado_em_apg != null ? Number(g.agrupado_em_apg) : null;
  const [membros, setMembros] = useState<Array<Record<string, unknown>> | null>(null);
  const [modo, setModo] = useState<'analitico' | 'totalizado' | 'funcionario'>('analitico');
  const [pesquisando, setPesquisando] = useState(false);
  const recarregar = useCallback(() => { membrosAgrupamento('areceber', codrcb).then(setMembros).catch((e) => mensagem.erro(e)); }, [codrcb, mensagem]);
  useEffect(() => { if (consolidado) recarregar(); else setMembros(null); }, [consolidado, recarregar]);
  const reverter = async () => {
    if (!window.confirm('Deseja realmente reverter o agrupamento?')) return;
    try { await reverterAgrupamento('areceber', codrcb); mensagem.sucesso('Reversão realizada com sucesso.'); await carregar?.(codrcb); } catch (e) { mensagem.erro(e); }
  };
  const remover = async (m: Record<string, unknown>) => {
    if (!window.confirm(`Deseja realmente remover o título: Documento [${String(m.duplicata ?? '')}] Dt. Venc. [${fmtData(m.dtvenc)}] Valor [${fmtBRL(num(m.valor))}]?`)) return;
    try { await removerDoAgrupamento(codrcb, Number(m.codrcb)); mensagem.sucesso('Título removido com sucesso!'); recarregar(); await carregar?.(codrcb); } catch (e) { mensagem.erro(e); }
  };
  const adicionar = async (ls: Array<Record<string, unknown>>) => {
    setPesquisando(false);
    const cods = ls.map((l) => Number(l.codigo ?? l.codrcb)).filter((c) => c > 0);
    if (!cods.length) return;
    try { await adicionarAoAgrupamento(codrcb, cods); mensagem.sucesso('Título(s) incluído com sucesso!'); recarregar(); await carregar?.(codrcb); } catch (e) { mensagem.erro(e); }
  };
  if (!consolidado) {
    return (
      <div className="flex flex-wrap items-center gap-gp-sm text-body-sm text-fg-muted">
        {emRcb != null && <>Este título está agrupado no documento <b className="text-fg-default">{emRcb}</b>. <Button label="Abrir o agrupamento" variant="ghost" onClick={() => carregar?.(emRcb)} /></>}
        {emRcb == null && emApg != null && <>Este título está agrupado na conta a pagar <b className="text-fg-default">{emApg}</b> (o convênio). <Button label="Abrir a conta a pagar" variant="ghost" onClick={() => navigate(`/cadastro/apagar?codigo=${emApg}`)} /></>}
        {emRcb == null && emApg == null && 'Esta conta não possui grupo de agrupamento.'}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-form-gap">
      <div className="flex flex-wrap items-end gap-gp-sm">
        <Button label="&Reverter agrupamento" variant="soft" onClick={reverter} />
        <Button label="&Adicionar titulo ao agrupamento" variant="soft" onClick={() => setPesquisando(true)} />
        <SelectField label="Tipo Relatório" options={[{ value: 'analitico', label: 'Analítico' }, { value: 'totalizado', label: 'Sintético' }, { value: 'funcionario', label: 'Extrato funcionário' }]} value={modo} onChange={(v) => setModo((v as typeof modo) || 'analitico')} />
        <Button label="Impri&mir" variant="soft" onClick={() => imprimirRelatorio(`/cadastro/areceber/${codrcb}/relatorio-agrupamento/impressao?modo=${modo}`).catch((e) => mensagem.erro(e))} />
      </div>
      {pesquisando && (
        <Pesquisa resourcePath="financeiro/agrupar-receber" multisselecao onSelecionarVarios={(ls) => void adicionar(ls)} onSelecionar={(l) => void adicionar([l])} onFechar={() => setPesquisando(false)} />
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead><tr className="border-b border-border"><th className={th}>Documento</th><th className={th}>Cliente</th><th className={th}>Duplicata</th><th className={th}>Dt.Venc.</th><th className={`${th} text-right`}>Valor</th><th className={th}>Dt.Venda</th><th className={th}>Pedido</th><th className={th}>Tipo doc.</th><th className={th}></th></tr></thead>
          <tbody>
            {(membros ?? []).map((m) => (
              <tr key={String(m.codrcb)} className="border-b border-border">
                <td className={td}><button type="button" className="underline" onClick={() => carregar?.(Number(m.codrcb))}>{String(m.codrcb)}</button></td>
                <td className={td}>{String(m.razao ?? m.nomecliente ?? '')}</td><td className={td}>{String(m.duplicata ?? '')}</td><td className={td}>{fmtData(m.dtvenc)}</td>
                <td className={tdNum}>{fmtBRL(num(m.valor))}</td><td className={td}>{fmtData(m.dtvenda)}</td><td className={td}>{String(m.nropedido ?? '')}</td><td className={td}>{String(m.tipodoc ?? '')}</td>
                <td className={td}><Button label="Remover" variant="ghost" onClick={() => remover(m)} /></td>
              </tr>
            ))}
            {membros != null && !membros.length && <tr><td className={`${td} text-fg-muted`} colSpan={9}>Nenhum título agrupado.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** faixa read-only com o estado + juro/total calculados pela view (aparecem em título já gravado). */
function EstadoBar({ form }: { form: UseFormReturn<CriarAreceberDto> }) {
  const g = form.getValues() as Record<string, unknown>;
  const juro = Number(g.juro) || 0;
  const total = Number(g.total) || 0;
  const quitada = (form.watch('quitada' as any) ?? g.quitada) === 'S';
  const agrupado = (form.watch('agrupado' as any) ?? g.agrupado) === 'S';
  if (g.codrcb == null) return null; // só em título gravado
  return (
    <div className="flex flex-wrap items-center gap-gp-sm rounded-radius-md border border-border bg-bg-surface px-pad-md py-pad-sm text-body-sm">
      <span className="text-fg-muted">Situação:</span>
      <span className="rounded-radius-base bg-bg-subtle px-pad-sm py-pad-xs font-semibold text-fg-default">
        {quitada ? 'Quitado' : agrupado ? 'Agrupado' : 'Em aberto'}
      </span>
      <span className="ml-auto text-fg-muted">Juros</span>
      <span className="tabular-nums text-fg-default">R$ {fmtBRL(juro)}</span>
      <span className="text-fg-muted">Total</span>
      <span className="tabular-nums font-semibold text-fg-default">R$ {fmtBRL(total)}</span>
    </div>
  );
}

/** a BAIXA é a tela própria do legado (`FRMBAIXAARECEBER`, em lote); a reversão, a consulta de baixas por lote (`FRMCONSRCBBX`) */
function BaixaSection({ form }: { form: UseFormReturn<CriarAreceberDto> }) {
  const navigate = useNavigate();
  const g = form.getValues() as Record<string, unknown>;
  const codrcb = g.codrcb as number | undefined;
  const quitada = (form.watch('quitada' as any) ?? g.quitada) === 'S';
  const agrupado = (form.watch('agrupado' as any) ?? g.agrupado) === 'S';
  if (codrcb == null || agrupado) return null;
  return (
    <div className="flex flex-wrap items-center gap-gp-sm rounded-radius-base border border-border bg-bg-subtle p-pad-sm">
      {quitada
        ? <><span className="text-fg-muted">Título recebido. A reversão da baixa é pelo lote.</span><Button label="Baixas do a receber (lotes)" variant="ghost" onClick={() => navigate('/cobranca/cons-rcb-bx')} /></>
        : <><span className="text-fg-muted">O recebimento é feito na tela de baixa, em lote.</span><Button label="&Baixar na tela de baixa" variant="soft" onClick={() => navigate('/cobranca/baixa-receber')} /></>}
    </div>
  );
}

/** "Nota fiscal (nº)" (edtNumeNota/btnNRONF): o número resolve a NF processada do cliente; mais de uma pede a escolha */
function NotaFiscalDaConta({ form, editavel, trava }: { form: UseFormReturn<CriarAreceberDto>; editavel: boolean; trava: boolean }) {
  const mensagem = useMensagem();
  const [opcoes, setOpcoes] = useState<NfDaConta[] | null>(null);
  const [pesquisando, setPesquisando] = useState(false);
  const docnf = String(form.watch('docnf' as any) ?? '');
  const escolher = (nf: NfDaConta) => {
    form.setValue('idnf' as any, Number(nf.codnf) as any, { shouldDirty: true });
    form.setValue('docnf' as any, String(nf.nronf ?? '') as any, { shouldDirty: true });
    if (nf.codparceiro) form.setValue('codparceiro', Number(nf.codparceiro) as any, { shouldDirty: true });
    setOpcoes(null);
  };
  const resolver = async () => {
    const n = docnf.trim();
    if (!n) { form.setValue('idnf' as any, undefined as any, { shouldDirty: true }); return; }
    try {
      const nfs = await nfsDaConta(n, Number(form.getValues('codparceiro' as any)) || undefined);
      if (!nfs.length) { mensagem.erro(new Error('Nota fiscal não existe. Verifique!')); form.setValue('idnf' as any, undefined as any); return; }
      if (nfs.length === 1) escolher(nfs[0]);
      else setOpcoes(nfs);
    } catch (e) { mensagem.erro(e); }
  };
  return (
    <>
      <div className="flex items-end gap-gp-xs">
        <Field label="Nota fiscal (nº)" maxLength={20} disabled={!editavel || trava} {...form.register('docnf' as any)} onBlur={() => void resolver()} />
        <Button label="…" variant="ghost" onClick={() => setPesquisando(true)} disabled={!editavel || trava} />
      </div>
      {opcoes && (
        <div className="col-span-full rounded-radius-base border border-border bg-bg-subtle p-pad-sm text-body-sm">
          <b>SELECIONE A NOTA FISCAL CORRETA</b>
          <ul className="mt-gp-xs flex flex-col gap-gp-xs">{opcoes.map((o) => <li key={o.codnf}><Button label={`${o.codnf} - FORN. - ${o.razao ?? ''}`} variant="ghost" onClick={() => escolher(o)} /></li>)}</ul>
        </div>
      )}
      {pesquisando && (
        <Pesquisa resourcePath="fiscal/nf" parametros={{ tipo: 'S' }} onFechar={() => setPesquisando(false)}
          onSelecionar={(l) => { setPesquisando(false); escolher({ codnf: Number(l.codigo ?? l.codnf), nronf: (l.nro_nf ?? l.nronf) as string, codparceiro: Number(l.cod_parceiro ?? l.codparceiro) || null, razao: null }); }} />
      )}
    </>
  );
}

function CadastroTab({ form, editavel, opts, bloqueados, podeMulta }: {
  form: UseFormReturn<CriarAreceberDto>;
  editavel: boolean;
  opts: LookupOptions;
  bloqueados: Set<string>;
  podeMulta: boolean;
}) {
  const err = form.formState.errors;
  const trava = (campo: string) => bloqueados.has(campo);
  const nrodup = Number(form.watch('nrodup' as any) ?? 1) || 1;
  return (
    <fieldset disabled={!editavel} className="border-0 p-0">
      {/* cliente (largo) */}
      <Controller
        control={form.control}
        name="codparceiro"
        render={({ field }) => (
          // uCadAReceber.pas:680-686 — GET_PARCEIROS, (CLI='S' OR FRN='S') AND ATIVADO='S' e os parceiros permitidos pela situação
          <LookupField
            label="Cliente"
            recurso="lookup/parceiros"
            campoCodigo="codparceiro"
            descricao="razao"
            fixos={{ 'cli|frn': 'S', ativado: 'S' }}
            parametros={{ idsituacao_nf: form.watch('idsituacao_nf' as any) }}
            value={field.value as number | undefined}
            onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)}
            error={err.codparceiro?.message as string | undefined}
            disabled={!editavel || trava('codparceiro')}
          />
        )}
      />
      {/* documento */}
      <div className="mt-form-gap grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-4">
        <Field label="Duplicata" maxLength={20} disabled={trava('duplicata')} {...form.register('duplicata')} />
        <Controller
          control={form.control}
          name="tipodoc"
          render={({ field }) => (
            <SelectField
              label="&Tipo de cobrança"
              options={AR_TIPODOC_OPCOES as unknown as Opcao[]}
              value={(field.value as string) ?? undefined}
              onChange={(v) => field.onChange(v || undefined)}
              placeholder="Selecione…"
            />
          )}
        />
        <Field label="Nº pedido" maxLength={20} disabled={trava('nroped')} {...form.register('nroped')} />
        <Field label="Nº &cupom" maxLength={20} disabled={trava('nrocupom')} {...form.register('nrocupom')} />
        <NotaFiscalDaConta form={form} editavel={editavel} trava={trava('codparceiro')} />
      </div>
      {/* datas e valores */}
      <div className="mt-form-gap grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-5">
        <Controller
          control={form.control}
          name="dtvenda"
          render={({ field }) => (
            <DateField label="Data de venda" value={(field.value as string) || undefined} onChange={(v) => field.onChange(v ?? '')} error={err.dtvenda?.message as string | undefined} disabled={trava('dtvenda')} />
          )}
        />
        <Controller
          control={form.control}
          name="dtvenc"
          render={({ field }) => (
            <DateField label="Vencimento" value={(field.value as string) || undefined} onChange={(v) => field.onChange(v ?? '')} error={err.dtvenc?.message as string | undefined} />
          )}
        />
        <Controller
          control={form.control}
          name="valor"
          render={({ field }) => (
            <CurrencyField label="Valor" value={field.value as number | undefined} onChange={field.onChange} disabled={trava('valor')} />
          )}
        />
        <Controller
          control={form.control}
          name="txjuros"
          render={({ field }) => (
            <NumberField label="Juros (%)" value={field.value as number | undefined} onChange={field.onChange} decimais={2} min={0} disabled={trava('txjuros')} />
          )}
        />
        <Controller
          control={form.control}
          name="nrodup"
          render={({ field }) => (
            <NumberField label="&Parcelas" value={field.value as number | undefined} onChange={field.onChange} decimais={0} min={1} disabled={trava('nrodup')} />
          )}
        />
      </div>
      <div className="mt-form-gap grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-5">
        {/* "Valor total" (edtTOTAL — vazio = Vr. parcela × Parcelas), a forma de pagamento (obrigatória: 771 de 771 em 2026), "Desc. boleto (%)" e a multa (EDTMULTA) */}
        {(form.getValues() as Record<string, unknown>).codrcb == null ? (
          <Controller control={form.control} name={'total' as never} render={({ field }) => (
            <CurrencyField label="Valor total" value={(field.value as number | undefined) ?? undefined} onChange={field.onChange} disabled={trava('valor') || nrodup <= 1}
              error={(err as Record<string, { message?: string }>).total?.message} />
          )} />
        ) : (
          <CurrencyField label="Valor total" value={num((form.getValues() as Record<string, unknown>).total_documento) || undefined} onChange={() => undefined} disabled />
        )}
        <Controller control={form.control} name="idpgto" render={({ field }) => (
          <div className="col-span-2">
            <LookupField label="&Forma de pagamento" recurso="cadastro/formas-pgto" campoCodigo="codigo" descricao="modalidade"
              value={field.value as number | undefined} onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)} disabled={!editavel} error={err.idpgto?.message as string | undefined} />
          </div>
        )} />
        <Controller control={form.control} name="desconto_boleto" render={({ field }) => (
          <NumberField label="Desc. boleto (%)" value={field.value as number | undefined} onChange={field.onChange} decimais={2} min={0} disabled={trava('desconto_boleto')} />
        )} />
        <Controller control={form.control} name="txmulta" render={({ field }) => (
          <NumberField label="Multa (%)" value={field.value as number | undefined} onChange={field.onChange} decimais={2} min={0} disabled={!podeMulta} />
        )} />
      </div>
      {/* lookups auxiliares */}
      <div className="mt-form-gap grid grid-cols-1 gap-form-gap sm:grid-cols-2 lg:grid-cols-3">
        <Controller
          control={form.control}
          name="codvendedor"
          render={({ field }) => (
            // uCadAReceber.pas:408 — GET_PARCEIROS, FUN='S'
            <LookupField label="Vendedor" recurso="lookup/parceiros" campoCodigo="codparceiro" descricao="razao" fixos={{ fun: 'S' }}
              value={field.value as number | undefined} onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)} disabled={!editavel || trava('codvendedor')} />
          )}
        />
        <Controller
          control={form.control}
          name="codcobrador"
          render={({ field }) => (
            // uCadAReceber.pas:477 — GET_PARCEIROS, FUN='S'
            <LookupField label="Cobrador" recurso="lookup/parceiros" campoCodigo="codparceiro" descricao="razao" fixos={{ fun: 'S' }}
              value={field.value as number | undefined} onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)} disabled={!editavel || trava('codcobrador')} />
          )}
        />
        <Controller
          control={form.control}
          name="codbco"
          render={({ field }) => (
            // uCadAReceber.pas:4069 — GET_BANCOS, sem filtro
            <LookupField label="Banco" recurso="lookup/bancos" campoCodigo="codigo" descricao="banco"
              value={field.value as number | undefined} onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)} disabled={!editavel} />
          )}
        />
        <Controller
          control={form.control}
          name="codplc"
          render={({ field }) => (
            // uCadAReceber.pas:547-553 — GET_PLC, TIPO_CONTA='RECEITA' (o texto da view do legado); o comprimento da máscara e o
            // CODIGO IN da situação não são igualdade: ficam no servidor
            <LookupField label="Centro de custo" recurso="lookup/plc" campoDigitado="desccodplc" campoCodigo="codplc" descricao={descPlc} fixos={{ tipo_conta: 'RECEITA' }}
              parametros={{ lancavel: 'S', idsituacao_nf: form.watch('idsituacao_nf' as any) }}
              value={field.value as number | undefined} onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)} disabled={!editavel || trava('codplc')} />
          )}
        />
        <Controller
          control={form.control}
          name="idsituacao_nf"
          render={({ field }) => (
            <SelectField label="&Situação (natureza)" options={opts.situacaoOptions} value={field.value != null ? String(field.value) : undefined} onChange={(v) => field.onChange(v ? Number(v) : undefined)} placeholder="Opcional…" />
          )}
        />
      </div>
      <div className="mt-form-gap">
        <TextArea label="Observações" rows={2} disabled={trava('obs')} {...form.register('obs')} />
      </div>
    </fieldset>
  );
}
