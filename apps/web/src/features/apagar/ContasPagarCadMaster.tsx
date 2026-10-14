import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { apagarSchema, AP_TIPODOC_OPCOES, planejarParcelasApagar, ErroPlanoParcelas, type CriarApagarDto, type ParcelaApagarPlanejada } from '@apollo/shared';
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
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { membrosAgrupamento, reverterAgrupamento } from '../agrupamento/agrupamentoApi';
import {
  gerarParcelasApagar, gravarRateioApagar, parcelasApagar, pendenciasApagar, rateioApagar, resolverPendenciaApagar, ultimosLancamentosApagar,
  type LinhaRateioApagar, type ParcelaApagar, type PendenciaApagar, type TotaisParcelasApagar,
} from './apagarApi';

const hojeISO = () => hojeNaLoja();
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
/** a data como a grade do legado: dd/mm/aaaa (sem hora) */
const fmtData = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s;
};
/** o CASE do `sqqPendencias` */
export const STATUS_PENDENCIA_APAGAR: Record<string, string> = {
  D: 'Nota Fiscal Devolvida', E: 'Nota Fiscal Excluída', R: 'Nota Fiscal Revertida', C: 'Nota Fiscal Cancelada', N: 'Nota Fiscal Denegada',
};
/** as mensagens do Processar (btnGeraParcelasClick) para a prévia feita na tela */
const MSG_PLANO: Record<string, string> = {
  APAGAR_PARCELAS_SEM_CONFIG: 'Deve ser informado o dia de vencimento ou o intervalo em que serão geradas as parcelas. Verifique',
  APAGAR_PARCELAS_SEM_VENCIMENTO: 'O vencimento para primeira parcela esta vazio. Verifique',
  APAGAR_PARCELAS_NRODUP: 'Informe o número de parcelas (de 1 a 200).',
  PARCELA_VALOR_INSUFICIENTE: 'O valor total é insuficiente para o número de parcelas (cada parcela precisa de ao menos R$ 0,01).',
};
const th = 'py-1 pr-2 text-left font-semibold text-fg-muted';
const td = 'py-1 pr-2';
const tdNum = 'py-1 pr-2 text-right tabular-nums';

/**
 * CONTAS A PAGAR (uCadAPagar) — gêmea de A Receber: cadastro/gestão do título + baixa/pagamento,
 * layout tabulado fiel ao legado, visual do design system. O parceiro é o FORNECEDOR (frn='S').
 */
export function ContasPagarCadMaster() {
  // só as situações da operação da tela (UCadSituacaoNF.md C5)
  const situacaoOptions = useSituacoesDaOperacao('F04', 'E');

  const defaultValues = useMemo<Partial<CriarApagarDto>>(
    () => ({ dtvenda: hojeISO(), dtvenc: hojeISO(), nrodup: 1, tipodoc: 'DUPLICATA' }),
    [],
  );

  return (
    <CadMaster<CriarApagarDto>
      titulo="Contas a Pagar"
      resourcePath="cadastro/apagar"
      pk="codapg"
      // a Pesquisa lê a view do legado da opção escolhida (GET_APAGAR/GET_CP e as _CEN): o código que volta é o CODIGO (= codapg)
      viewPk="codigo"
      log={{ form: 'FRMAPAGAR', chave: 'CODAPG' }}
      schema={apagarSchema}
      defaultValues={defaultValues}
      largura="5xl"
      gerenciaEdicaoInterna
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'nr_documento', label: 'Duplicata', tipo: 'text', largura: 140 },
        { campo: 'fornecedor', label: 'Fornecedor', tipo: 'text' },
        { campo: 'vencimento', label: 'Vencimento', tipo: 'date', largura: 130 },
        { campo: 'valor', label: 'Valor', tipo: 'text', largura: 120 },
        { campo: 'quitada', label: 'Paga', tipo: 'text', largura: 90 },
      ]}
      campos={({ form, editavel, carregar }) => (
        <ApForm form={form} editavel={editavel} opts={{ situacaoOptions }} carregar={carregar} />
      )}
    />
  );
}

type LookupOptions = {
  situacaoOptions: Opcao[];
};

/** o combo do dfm + o valor gravado por outra tela (PREVISÃO do manifesto, RESIDUAL ST, DINHEIRO, ADIANTAMENTO) */
const tipodocOpcoes = (atual?: string): Opcao[] => {
  const base = AP_TIPODOC_OPCOES.map((o) => ({ value: o.value, label: o.label })) as Opcao[];
  return atual && !base.some((o) => o.value === atual) ? [...base, { value: atual, label: atual }] : base;
};

/** o centro de custo como o legado o mostra: o código extenso (DESCCODPLC) e a descrição */
const descPlc = (l: Record<string, any>) => `${l.desccodplc ?? l.codplc} - ${l.descricao ?? ''}`;

function ApForm({ form, editavel, opts, carregar }: { form: UseFormReturn<CriarApagarDto>; editavel: boolean; opts: LookupOptions; carregar?: (id: number) => Promise<void> }) {
  const [aba, setAba] = useState('cadastro');
  const g = form.getValues() as Record<string, unknown>;
  useSituacaoUnica(form, opts.situacaoOptions, g.codapg == null); // a única F04 entra sozinha (uAPagar.pas:6520)
  const quitada = (form.watch('quitada' as any) ?? g.quitada) === 'S';
  const agrupado = (form.watch('agrupado' as any) ?? g.agrupado) === 'S';
  const contabilizado = g.contabilizado === 'S';
  const idnf = g.idnf;
  // como o legado (uAPagar): só o título pago ou agrupado trava a tela; o de nota fiscal/fechamento trava só alguns campos
  const travado = quitada || agrupado;
  const liberado = editavel && !travado;
  const bloqueados = new Set(((g.campos_bloqueados as string[] | undefined) ?? []));

  const codapg = g.codapg as number | undefined;
  const opcoes = useOpcoesDoForm('FRMAPAGAR');
  // as abas do uAPagar.dfm (pgcGeral): Cadastro, Parcelas, Agrupados, Ultimos Lançamentos, Pendências — a "Convênio Funcionários"
  // não tem substrato (CONVENIO_FUN com 0 linhas; CONVENIO 'N' em todos os títulos) e fica fora
  const tabs: TabDef[] = [
    { id: 'cadastro', label: 'Cadastro' },
    { id: 'parcelas', label: '&Parcelas' },
    { id: 'agrupados', label: 'A&grupados', disabled: codapg == null },
    { id: 'ultimos', label: '&Ultimos Lançamentos', disabled: codapg == null },
    { id: 'pendencias', label: 'Pe&ndências' },
  ];

  return (
    <div className="flex flex-col gap-form-gap">
      {travado && (
        <div className="rounded-radius-base border border-border bg-bg-subtle p-pad-sm text-fg-muted">
          Título {quitada ? 'pago' : 'agrupado'} — edição bloqueada.
        </div>
      )}
      {!travado && (bloqueados.size > 0 || contabilizado) && (
        <div className="rounded-radius-base border border-border bg-bg-subtle p-pad-sm text-fg-muted">
          {bloqueados.size > 0 && <>Conta gerada automaticamente{idnf != null ? ' pela nota fiscal' : ''}: valor, fornecedor, juros, observação e centro de custo não se alteram aqui. </>}
          {contabilizado && <>Conta contabilizada: ao gravar, o lançamento contábil é refeito.</>}
        </div>
      )}
      <EstadoBar form={form} />
      <BaixaSection form={form} />
      <PendenciaBanner form={form} carregar={carregar} />
      <div>
        <Tabs tabs={tabs} active={aba} onChange={setAba} />
        <TabPanel>
          {aba === 'cadastro' && (
            <>
              <CadastroTab form={form} editavel={liberado} opts={opts} bloqueados={bloqueados} />
              {codapg != null && <RateioSection form={form} podeGravar={!travado && opcoes.tem('BTNGRAVAR') && !bloqueados.has('codplc')} />}
            </>
          )}
          {aba === 'parcelas' && <ParcelasTab form={form} editavel={editavel} travado={travado || bloqueados.has('nrodup')} podeGravar={opcoes.tem('BTNGRAVAR')} carregar={carregar} />}
          {aba === 'agrupados' && codapg != null && <AgrupadosTab form={form} podeReverter={opcoes.tem('BTNREVERTERAGRUPAMENTO')} carregar={carregar} />}
          {aba === 'ultimos' && codapg != null && <UltimosLancamentosTab codapg={codapg} carregar={carregar} />}
          {aba === 'pendencias' && <PendenciasTab podeResolver={opcoes.tem('BTNGRAVAR')} carregar={carregar} />}
        </TabPanel>
      </div>
    </div>
  );
}

/** a pendência do título (STATUS_PENDENCIA ≠ A): o aviso e o "Pendência Resolvida" (btnResolverPendencia) */
function PendenciaBanner({ form, carregar }: { form: UseFormReturn<CriarApagarDto>; carregar?: (id: number) => Promise<void> }) {
  const mensagem = useMensagem();
  const g = form.getValues() as Record<string, unknown>;
  const status = String(g.status_pendencia ?? '');
  const codapg = g.codapg as number | undefined;
  if (codapg == null || !status || status === 'A') return null;
  const resolver = async () => {
    try {
      await resolverPendenciaApagar(codapg);
      mensagem.sucesso('Pendências resolvidas com sucesso!');
      await carregar?.(codapg);
    } catch (e) { mensagem.erro(e); }
  };
  return (
    <div className="flex flex-wrap items-center gap-gp-sm rounded-radius-base border border-border bg-bg-subtle p-pad-sm">
      <span className="font-semibold text-fg-default">Pendência: {STATUS_PENDENCIA_APAGAR[status] ?? status}</span>
      <Button label="&Pendências Resolvidas" variant="soft" onClick={resolver} />
    </div>
  );
}

/**
 * O grupo "Lançamento centro custo" (edtCodPLC/CedValor + Adicionar/Excluir/Gravar CC): as linhas V do rateio do documento
 * (CX_APAGAR por CODGRUPO); as D/E do desconto e dos embutidos aparecem, mas quem as mantém é o gravar do título.
 */
function RateioSection({ form, podeGravar }: { form: UseFormReturn<CriarApagarDto>; podeGravar: boolean }) {
  const mensagem = useMensagem();
  const codapg = (form.getValues() as Record<string, unknown>).codapg as number;
  const [linhas, setLinhas] = useState<LinhaRateioApagar[] | null>(null);
  const [novo, setNovo] = useState<{ codcc?: number; valor?: number }>({});
  const [salvando, setSalvando] = useState(false);
  const recarregar = useCallback(() => { rateioApagar(codapg).then(setLinhas).catch((e) => mensagem.erro(e)); }, [codapg, mensagem]);
  useEffect(() => { recarregar(); }, [recarregar]);
  const linhasV = (linhas ?? []).filter((l) => (l.tipo ?? 'V') === 'V');
  const outras = (linhas ?? []).filter((l) => (l.tipo ?? 'V') !== 'V');
  const adicionar = () => {
    if (!novo.codcc) { mensagem.erro(new Error('Informe o cento de custo.')); return; }
    if (!novo.valor) { mensagem.erro(new Error('Informe o valor para o cento de custo.')); return; }
    setLinhas([...(linhas ?? []), { codcc: novo.codcc, valor: novo.valor, tipo: 'V' }]);
    setNovo({});
  };
  const excluir = (idx: number) => setLinhas((linhas ?? []).filter((l, i) => !((l.tipo ?? 'V') === 'V' && linhasV.indexOf(l) === idx && i >= 0)));
  const gravar = async (confirmado = false) => {
    if (!linhasV.length) { mensagem.erro(new Error('Necessário informar o centro de custo.')); return; }
    setSalvando(true);
    try {
      const r = await gravarRateioApagar(codapg, { linhas: linhasV.map((l) => ({ codcc: Number(l.codcc), valor: Number(l.valor), idsituacao_nf: l.idsituacao_nf ?? undefined })), confirmado });
      setLinhas(r);
      mensagem.sucesso('Centro de custo gravado.');
    } catch (e) {
      const env = (e as { envelope?: { code?: string; message?: string } }).envelope;
      // VERIFICA_CC_MAIOR_PARCELAS = Avisar: o "Deseja continuar?" do legado
      if (env?.code === 'APAGAR_CC_MAIOR_CONFIRMAR' && !confirmado && window.confirm(env.message ?? 'Deseja continuar?')) { setSalvando(false); await gravar(true); return; }
      mensagem.erro(e);
    } finally { setSalvando(false); }
  };
  const total = linhasV.reduce((s, l) => s + num(l.valor), 0);
  return (
    <fieldset disabled={!podeGravar} className="mt-form-gap rounded-radius-base border border-border p-pad-sm">
      <legend className="px-1 text-body-sm font-semibold text-fg-muted">Lançamento centro custo</legend>
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
        <LookupField label="Centro de custo" recurso="lookup/plc" campoDigitado="desccodplc" campoCodigo="codplc" descricao={descPlc} parametros={{ lancavel: 'S' }}
          value={novo.codcc} onChange={(cod) => setNovo({ ...novo, codcc: cod ? Number(cod) : undefined })} disabled={!podeGravar} />
        <CurrencyField label="Valor" value={novo.valor} onChange={(v) => setNovo({ ...novo, valor: v })} />
        <div className="flex items-end gap-gp-xs">
          <Button label="&Adicionar" variant="soft" onClick={adicionar} />
          <Button label="Gravar CC" variant="filled" onClick={() => gravar(false)} disabled={salvando} />
        </div>
      </div>
      <div className="mt-pad-sm overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead><tr className="border-b border-border"><th className={th}>Centro de custo</th><th className={th}>Descrição</th><th className={th}>Tipo</th><th className={`${th} text-right`}>Valor</th><th className={th}></th></tr></thead>
          <tbody>
            {linhasV.map((l, i) => (
              <tr key={`${l.codcxapagar ?? 'n'}-${i}`} className="border-b border-border">
                <td className={td}>{l.desccodplc ?? l.codcc}</td><td className={td}>{l.descricao ?? ''}</td><td className={td}>V</td>
                <td className={tdNum}>{fmtBRL(num(l.valor))}</td>
                <td className={td}><Button label="Excluir" variant="ghost" onClick={() => excluir(i)} /></td>
              </tr>
            ))}
            {outras.map((l, i) => (
              <tr key={`de-${i}`} className="border-b border-border text-fg-muted">
                <td className={td}>{l.desccodplc ?? l.codcc}</td><td className={td}>{l.descricao ?? ''}</td><td className={td}>{l.tipo}</td>
                <td className={tdNum}>{fmtBRL(num(l.valor))}</td><td className={td}></td>
              </tr>
            ))}
            {linhas != null && !linhas.length && <tr><td className={`${td} text-fg-muted`} colSpan={5}>Sem rateio de centro de custo.</td></tr>}
          </tbody>
          {linhasV.length > 0 && <tfoot><tr><td className={td} colSpan={3}>Total dos centros de custo</td><td className={`${tdNum} font-semibold`}>{fmtBRL(total)}</td><td></td></tr></tfoot>}
        </table>
      </div>
    </fieldset>
  );
}

/**
 * A aba PARCELAS (TbsCadastro + grbConfiguracao): a grade do documento (sqqAPagarGrupo), o total, o pago (edtPago) e o
 * PROCESSAR — intervalo em dias ou dia fixo do mês, "Incluir restantes na última parcela", vencimento da 1ª. No documento novo a
 * prévia é a da tela (o plano puro) e o Gravar grava as N parcelas; no gravado, o Processar refaz o grupo (sem parcela paga).
 */
function ParcelasTab({ form, editavel, travado, podeGravar, carregar }: {
  form: UseFormReturn<CriarApagarDto>; editavel: boolean; travado: boolean; podeGravar: boolean; carregar?: (id: number) => Promise<void>;
}) {
  const mensagem = useMensagem();
  const g = form.getValues() as Record<string, unknown>;
  const codapg = g.codapg as number | undefined;
  const nrodup = Number(form.watch('nrodup' as any) ?? 1) || 1;
  const valor = Number(form.watch('valor' as any) ?? 0) || 0;
  const dtvenc = String(form.watch('dtvenc' as any) ?? '');
  const geracao = (form.watch('geracao' as any) ?? {}) as { intervalo?: number; dia_fixo?: number; restantes_na_ultima?: boolean };
  const [previa, setPrevia] = useState<ParcelaApagarPlanejada[] | null>(null);
  const [dados, setDados] = useState<{ parcelas: ParcelaApagar[]; totais: TotaisParcelasApagar } | null>(null);
  const [cfg, setCfg] = useState<{ nrodup?: number; dtvenc?: string; intervalo?: number; dia_fixo?: number; restantes_na_ultima?: boolean; total?: number }>({});
  const [processando, setProcessando] = useState(false);
  const setGeracao = (patch: Partial<typeof geracao>) => form.setValue('geracao' as any, { ...geracao, ...patch } as any, { shouldDirty: true });
  useEffect(() => {
    if (codapg == null) { setDados(null); return; }
    parcelasApagar(codapg).then((d) => {
      setDados(d);
      setCfg({ nrodup: d.totais.nrodup, dtvenc: String(d.parcelas[0]?.dtvenc ?? '').slice(0, 10), total: d.totais.total_parcelas });
    }).catch((e) => mensagem.erro(e));
  }, [codapg, mensagem]);
  useEffect(() => { setPrevia(null); }, [nrodup, valor, dtvenc, geracao.intervalo, geracao.dia_fixo, geracao.restantes_na_ultima]);

  // o Processar do documento NOVO: a prévia pelo mesmo plano que a API grava
  const processarNovo = () => {
    try {
      setPrevia(planejarParcelasApagar({
        total: valor, nrodup, venc1: dtvenc, intervalo: geracao.intervalo, diaFixo: geracao.dia_fixo, restantesNaUltima: geracao.restantes_na_ultima,
        desconto: Number(g.desconto ?? 0), vendor: Number(g.vendor ?? 0), tipodoc: g.tipodoc as string | undefined, duplicata: g.duplicata as string | undefined, obs: g.obs as string | undefined,
      }));
    } catch (e) {
      mensagem.erro(new Error(e instanceof ErroPlanoParcelas ? (MSG_PLANO[e.code] ?? e.code) : String((e as Error).message)));
    }
  };
  // o Processar do documento GRAVADO: refaz o grupo
  const processarGravado = async () => {
    if (codapg == null) return;
    if (!cfg.intervalo && !cfg.dia_fixo) { mensagem.erro(new Error(MSG_PLANO.APAGAR_PARCELAS_SEM_CONFIG)); return; }
    if (!cfg.dtvenc) { mensagem.erro(new Error(MSG_PLANO.APAGAR_PARCELAS_SEM_VENCIMENTO)); return; }
    if (!window.confirm('As parcelas atuais do documento serão substituídas. Deseja continuar?')) return;
    setProcessando(true);
    try {
      const r = await gerarParcelasApagar(codapg, { nrodup: cfg.nrodup ?? 1, dtvenc: cfg.dtvenc, total: cfg.total, intervalo: cfg.intervalo, dia_fixo: cfg.dia_fixo, restantes_na_ultima: cfg.restantes_na_ultima });
      mensagem.sucesso('Documento(s) gerado(s) com sucesso!');
      await carregar?.(r.codapgs[0]);
    } catch (e) { mensagem.erro(e); } finally { setProcessando(false); }
  };

  const novo = codapg == null;
  const linhas: Array<Record<string, unknown>> = novo ? ((previa ?? []) as unknown as Array<Record<string, unknown>>) : (dados?.parcelas ?? []);
  return (
    <div className="flex flex-col gap-form-gap">
      <fieldset disabled={novo ? !editavel : (travado || !podeGravar)} className="rounded-radius-base border border-border p-pad-sm">
        <legend className="px-1 text-body-sm font-semibold text-fg-muted">Configuração</legend>
        <div className="grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-6">
          {novo ? (
            <>
              <NumberField label="&Intervalo (dias)" value={geracao.intervalo} onChange={(v) => setGeracao({ intervalo: v ?? undefined })} decimais={0} min={0} />
              <NumberField label="Dia &inicial (dia fixo)" value={geracao.dia_fixo} onChange={(v) => setGeracao({ dia_fixo: v ?? undefined })} decimais={0} min={1} />
              <div className="col-span-2"><CheckboxField label="Incluir restantes na última parcela" value={geracao.restantes_na_ultima ? 'S' : 'N'} onChange={(v) => setGeracao({ restantes_na_ultima: v === 'S' })} /></div>
              <div className="self-end text-body-sm text-fg-muted">Parcelas: {nrodup} · 1º vencimento {fmtData(dtvenc)} · total R$ {fmtBRL(valor)}</div>
              <div className="self-end"><Button label="&Processar" variant="soft" onClick={processarNovo} disabled={nrodup <= 1} /></div>
            </>
          ) : (
            <>
              <NumberField label="Parcelas" value={cfg.nrodup} onChange={(v) => setCfg({ ...cfg, nrodup: v ?? undefined })} decimais={0} min={1} />
              <NumberField label="&Intervalo (dias)" value={cfg.intervalo} onChange={(v) => setCfg({ ...cfg, intervalo: v ?? undefined })} decimais={0} min={0} />
              <NumberField label="Dia &inicial (dia fixo)" value={cfg.dia_fixo} onChange={(v) => setCfg({ ...cfg, dia_fixo: v ?? undefined })} decimais={0} min={1} />
              <DateField label="Vencimento (1ª)" value={cfg.dtvenc || undefined} onChange={(v) => setCfg({ ...cfg, dtvenc: v ?? '' })} />
              <CurrencyField label="Total do documento" value={cfg.total} onChange={(v) => setCfg({ ...cfg, total: v })} />
              <div className="flex flex-col gap-gp-xs self-end">
                <CheckboxField label="Incluir restantes na última parcela" value={cfg.restantes_na_ultima ? 'S' : 'N'} onChange={(v) => setCfg({ ...cfg, restantes_na_ultima: v === 'S' })} />
                <Button label="&Processar" variant="soft" onClick={processarGravado} disabled={processando} />
              </div>
            </>
          )}
        </div>
      </fieldset>
      {!novo && dados && (
        <div className="flex flex-wrap gap-gp-md text-body-sm">
          <span className="text-fg-muted">Parcelas: <b className="text-fg-default">{dados.totais.nrodup}</b></span>
          <span className="text-fg-muted">Total das parcelas: <b className="tabular-nums text-fg-default">R$ {fmtBRL(dados.totais.total_parcelas)}</b></span>
          <span className="text-fg-muted">Total do documento: <b className="tabular-nums text-fg-default">R$ {fmtBRL(dados.totais.total_documento)}</b></span>
          <span className="text-fg-muted">Pago: <b className="tabular-nums text-fg-default">R$ {fmtBRL(dados.totais.total_pago)}</b></span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead><tr className="border-b border-border">
            <th className={th}>Código</th><th className={th}>Parcela</th><th className={th}>Duplicata</th><th className={th}>Vencimento</th>
            <th className={`${th} text-right`}>Valor</th><th className={`${th} text-right`}>Desconto</th><th className={`${th} text-right`}>Embutidos</th><th className={th}>Paga</th><th className={th}>Observação</th>
          </tr></thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={String(l.codapg ?? i)} className={`border-b border-border ${!novo && carregar ? 'cursor-pointer hover:bg-bg-subtle' : ''}`}
                onClick={() => { if (!novo && l.codapg != null && Number(l.codapg) !== codapg) void carregar?.(Number(l.codapg)); }}>
                <td className={td}>{novo ? '—' : String(l.codapg)}</td><td className={td}>{String(l.nrparcela ?? '')}</td><td className={td}>{String(l.duplicata ?? '')}</td>
                <td className={td}>{fmtData(l.dtvenc)}</td><td className={tdNum}>{fmtBRL(num(l.valor))}</td><td className={tdNum}>{fmtBRL(num(l.desconto))}</td>
                <td className={tdNum}>{fmtBRL(num(l.vendor))}</td><td className={td}>{novo ? 'N' : String(l.quitada ?? 'N')}</td><td className={td}>{String(l.obs ?? '')}</td>
              </tr>
            ))}
            {!linhas.length && <tr><td className={`${td} text-fg-muted`} colSpan={9}>{novo ? 'Informe as parcelas e clique em Processar para ver a prévia.' : 'Sem parcelas.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** a aba AGRUPADOS (TabHistorico): os títulos agrupados no consolidado, Reverter Agrupamento e Imprimir (Analítico/Sintético) — e, no membro, o consolidado que o agrupou */
function AgrupadosTab({ form, podeReverter, carregar }: { form: UseFormReturn<CriarApagarDto>; podeReverter: boolean; carregar?: (id: number) => Promise<void> }) {
  const mensagem = useMensagem();
  const g = form.getValues() as Record<string, unknown>;
  const codapg = g.codapg as number;
  const consolidado = g.agrupamento === 'S';
  const agrupadoEm = g.agrupado_em != null ? Number(g.agrupado_em) : null;
  const [membros, setMembros] = useState<Array<Record<string, unknown>> | null>(null);
  const [tipoRel, setTipoRel] = useState<'analitico' | 'sintetico'>('analitico');
  useEffect(() => {
    if (!consolidado) { setMembros(null); return; }
    membrosAgrupamento('apagar', codapg).then(setMembros).catch((e) => mensagem.erro(e));
  }, [consolidado, codapg, mensagem]);
  const reverter = async () => {
    if (!window.confirm('Deseja realmente reverter o agrupamento?')) return;
    try {
      await reverterAgrupamento('apagar', codapg);
      mensagem.sucesso('Reversão realizada com sucesso.');
      await carregar?.(codapg);
    } catch (e) { mensagem.erro(e); }
  };
  if (!consolidado) {
    return (
      <div className="flex flex-wrap items-center gap-gp-sm text-body-sm text-fg-muted">
        {agrupadoEm != null
          ? <>Este título está agrupado no documento <b className="text-fg-default">{agrupadoEm}</b>. <Button label="Abrir o agrupamento" variant="ghost" onClick={() => carregar?.(agrupadoEm)} /></>
          : 'Contas a pagar não possui grupo.'}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-form-gap">
      <div className="flex flex-wrap items-end gap-gp-sm">
        <Button label="&Reverter Agrupamento" variant="soft" onClick={reverter} disabled={!podeReverter} />
        <SelectField label="Tipo Relatório" options={[{ value: 'analitico', label: 'Analítico' }, { value: 'sintetico', label: 'Sintético' }]} value={tipoRel} onChange={(v) => setTipoRel((v as 'analitico' | 'sintetico') || 'analitico')} />
        <Button label="Impri&mir" variant="soft" onClick={() => imprimirRelatorio(`/cadastro/apagar/${codapg}/relatorio-agrupamento/impressao?agrupado=${tipoRel === 'sintetico' ? 1 : 0}`).catch((e) => mensagem.erro(e))} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead><tr className="border-b border-border"><th className={th}>Código</th><th className={th}>Duplicata</th><th className={th}>Vencimento</th><th className={`${th} text-right`}>Valor</th><th className={th}>Paga</th></tr></thead>
          <tbody>
            {(membros ?? []).map((m) => (
              <tr key={String(m.codapg)} className="cursor-pointer border-b border-border hover:bg-bg-subtle" onClick={() => carregar?.(Number(m.codapg))}>
                <td className={td}>{String(m.codapg)}</td><td className={td}>{String(m.duplicata ?? '')}</td><td className={td}>{fmtData(m.dtvenc)}</td>
                <td className={tdNum}>{fmtBRL(num(m.valor))}</td><td className={td}>{String(m.quitada ?? 'N')}</td>
              </tr>
            ))}
            {membros != null && !membros.length && <tr><td className={`${td} text-fg-muted`} colSpan={5}>Nenhum título agrupado.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** a aba ULTIMOS LANÇAMENTOS (dgbUltimosLanc): os títulos do fornecedor nos últimos 365 dias; duplo clique abre */
function UltimosLancamentosTab({ codapg, carregar }: { codapg: number; carregar?: (id: number) => Promise<void> }) {
  const mensagem = useMensagem();
  const [linhas, setLinhas] = useState<Array<Record<string, unknown>> | null>(null);
  useEffect(() => { ultimosLancamentosApagar(codapg).then(setLinhas).catch((e) => mensagem.erro(e)); }, [codapg, mensagem]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-sm">
        <thead><tr className="border-b border-border">
          <th className={th}>Código</th><th className={th}>Compra</th><th className={th}>Duplicata</th><th className={th}>Parcela</th><th className={th}>Vencimento</th>
          <th className={`${th} text-right`}>Valor</th><th className={th}>Tipo</th><th className={th}>Paga</th><th className={th}>Loja</th><th className={th}>Observação</th>
        </tr></thead>
        <tbody>
          {(linhas ?? []).map((l) => (
            <tr key={String(l.codapg)} className="cursor-pointer border-b border-border hover:bg-bg-subtle" onDoubleClick={() => carregar?.(Number(l.codapg))}>
              <td className={td}>{String(l.codapg)}</td><td className={td}>{fmtData(l.dtcompra)}</td><td className={td}>{String(l.duplicata ?? '')}</td><td className={td}>{String(l.nrparcela ?? '')}</td>
              <td className={td}>{fmtData(l.dtvenc)}</td><td className={tdNum}>{fmtBRL(num(l.valor))}</td><td className={td}>{String(l.tipodoc ?? '')}</td>
              <td className={td}>{String(l.quitada ?? 'N')}</td><td className={td}>{String(l.idempresa ?? '')}</td><td className={td}>{String(l.obs ?? '')}</td>
            </tr>
          ))}
          {linhas != null && !linhas.length && <tr><td className={`${td} text-fg-muted`} colSpan={10}>Não existem lançamentos para este fornecedor nos últimos 365 dias.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** a aba PENDÊNCIAS (dbgPendencias + edtLocalizar + pmPendencias): a fila das NFs devolvidas/excluídas/revertidas/canceladas/denegadas */
function PendenciasTab({ podeResolver, carregar }: { podeResolver: boolean; carregar?: (id: number) => Promise<void> }) {
  const mensagem = useMensagem();
  const [localizar, setLocalizar] = useState('');
  const [linhas, setLinhas] = useState<PendenciaApagar[] | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const buscar = useCallback((texto: string) => { pendenciasApagar(texto).then(setLinhas).catch((e) => mensagem.erro(e)); }, [mensagem]);
  useEffect(() => { buscar(''); }, [buscar]);
  const resolver = async () => {
    if (sel == null) return;
    try {
      await resolverPendenciaApagar(sel);
      mensagem.sucesso('Pendências resolvidas com sucesso!');
      setSel(null);
      buscar(localizar);
    } catch (e) { mensagem.erro(e); }
  };
  return (
    <div className="flex flex-col gap-form-gap">
      <div className="flex flex-wrap items-end gap-gp-sm">
        <Field label="&Localizar (código, duplicata ou NF)" value={localizar} onChange={(e) => setLocalizar(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(localizar); } }} onBlur={() => buscar(localizar)} />
        <Button label="&Abrir Conta a Pagar" variant="soft" onClick={() => { if (sel != null) void carregar?.(sel); }} disabled={sel == null} />
        <Button label="&Pendência Resolvida" variant="soft" onClick={resolver} disabled={sel == null || !podeResolver} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead><tr className="border-b border-border">
            <th className={th}>Código</th><th className={th}>Duplicata</th><th className={th}>NF</th><th className={th}>Vencimento</th><th className={`${th} text-right`}>Valor</th><th className={th}>Parcela</th><th className={th}>Pendência</th><th className={th}>Observação</th>
          </tr></thead>
          <tbody>
            {(linhas ?? []).map((l) => (
              <tr key={l.codapg} className={`cursor-pointer border-b border-border ${sel === l.codapg ? 'bg-bg-subtle' : 'hover:bg-bg-subtle'}`}
                onClick={() => setSel(l.codapg)} onDoubleClick={() => carregar?.(l.codapg)}>
                <td className={td}>{l.codapg}</td><td className={td}>{l.duplicata ?? ''}</td><td className={td}>{l.idnf ?? ''}</td><td className={td}>{fmtData(l.dtvenc)}</td>
                <td className={tdNum}>{fmtBRL(num(l.valor))}</td><td className={td}>{l.nrparcela ?? ''}</td><td className={td}>{l.status_pendencia ?? ''}</td><td className={td}>{l.obs ?? ''}</td>
              </tr>
            ))}
            {linhas != null && !linhas.length && <tr><td className={`${td} text-fg-muted`} colSpan={8}>Nenhuma pendência.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EstadoBar({ form }: { form: UseFormReturn<CriarApagarDto> }) {
  const g = form.getValues() as Record<string, unknown>;
  const juro = Number(g.juro) || 0;
  const total = Number(g.total) || 0;
  const quitada = (form.watch('quitada' as any) ?? g.quitada) === 'S';
  const agrupado = (form.watch('agrupado' as any) ?? g.agrupado) === 'S';
  if (g.codapg == null) return null;
  return (
    <div className="flex flex-wrap items-center gap-gp-sm rounded-radius-md border border-border bg-bg-surface px-pad-md py-pad-sm text-body-sm">
      <span className="text-fg-muted">Situação:</span>
      <span className="rounded-radius-base bg-bg-subtle px-pad-sm py-pad-xs font-semibold text-fg-default">
        {quitada ? 'Pago' : agrupado ? 'Agrupado' : 'Em aberto'}
      </span>
      <span className="ml-auto text-fg-muted">Juros</span>
      <span className="tabular-nums text-fg-default">R$ {fmtBRL(juro)}</span>
      <span className="text-fg-muted">Total</span>
      <span className="tabular-nums font-semibold text-fg-default">R$ {fmtBRL(total)}</span>
    </div>
  );
}

/** a BAIXA é a tela própria do legado (`FRMBAIXAAPAGAR`, em lote); a reversão, a consulta de baixas por lote (`FRMCONSAPGBX`) */
function BaixaSection({ form }: { form: UseFormReturn<CriarApagarDto> }) {
  const navigate = useNavigate();
  const g = form.getValues() as Record<string, unknown>;
  const codapg = g.codapg as number | undefined;
  const quitada = (form.watch('quitada' as any) ?? g.quitada) === 'S';
  const agrupado = (form.watch('agrupado' as any) ?? g.agrupado) === 'S';
  if (codapg == null || agrupado) return null;
  return (
    <div className="flex flex-wrap items-center gap-gp-sm rounded-radius-base border border-border bg-bg-subtle p-pad-sm">
      {quitada
        ? <><span className="text-fg-muted">Título pago. A reversão da baixa é pelo lote.</span><Button label="Baixas do a pagar (lotes)" variant="ghost" onClick={() => navigate('/cobranca/cons-apg-bx')} /></>
        : <><span className="text-fg-muted">O pagamento é feito na tela de baixa, em lote.</span><Button label="&Baixar na tela de baixa" variant="soft" onClick={() => navigate('/cobranca/baixa-apagar')} /></>}
    </div>
  );
}

function CadastroTab({ form, editavel, opts, bloqueados }: { form: UseFormReturn<CriarApagarDto>; editavel: boolean; opts: LookupOptions; bloqueados: Set<string> }) {
  const err = form.formState.errors;
  const trava = (campo: string) => bloqueados.has(campo);
  return (
    <fieldset disabled={!editavel} className="border-0 p-0">
      <Controller
        control={form.control}
        name="codparceiro"
        render={({ field }) => (
          // uAPagar.pas:6115-6119 — GET_PARCEIROS, FRN='S' AND ATIVADO='S' e os parceiros permitidos pela situação do documento
          <LookupField
            label="Fornecedor"
            recurso="lookup/parceiros"
            campoCodigo="codparceiro"
            descricao="razao"
            fixos={{ frn: 'S', ativado: 'S' }}
            statusTela={{ pai: 'frmAPagar', retorno: 'edtCODPARCEIRO' }}
            parametros={{ idsituacao_nf: form.watch('idsituacao_nf' as any) }}
            value={field.value as number | undefined}
            onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)}
            error={err.codparceiro?.message as string | undefined}
            disabled={!editavel || trava('codparceiro')}
          />
        )}
      />
      <div className="mt-form-gap grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-4">
        <Field label="&Duplicata" maxLength={20} disabled={trava('duplicata')} {...form.register('duplicata')} />
        <Controller
          control={form.control}
          name="tipodoc"
          render={({ field }) => (
            // o combo cbbTIPODOC do dfm (11 itens); o valor de outra origem (PREVISÃO, RESIDUAL ST, DINHEIRO…) continua visível
            <SelectField label="&Tipo de documento" options={tipodocOpcoes(field.value as string | undefined)} value={(field.value as string) ?? undefined} onChange={(v) => field.onChange(v || undefined)} placeholder="Selecione…" />
          )}
        />
        <Field label="Nº &pedido" maxLength={20} {...form.register('nroped')} />
        <Field label="Nº &cupom" maxLength={20} {...form.register('nrocupom')} />
      </div>
      <div className="mt-form-gap grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-5">
        <Controller control={form.control} name="dtvenda" render={({ field }) => (
          <DateField label="Data de &compra" value={(field.value as string) || undefined} onChange={(v) => field.onChange(v ?? '')} error={err.dtvenda?.message as string | undefined} />
        )} />
        <Controller control={form.control} name="dtvenc" render={({ field }) => (
          <DateField label="Vencimento" value={(field.value as string) || undefined} onChange={(v) => field.onChange(v ?? '')} error={err.dtvenc?.message as string | undefined} />
        )} />
        <Controller control={form.control} name="valor" render={({ field }) => (
          <CurrencyField label="Valor" value={field.value as number | undefined} onChange={field.onChange} disabled={trava('valor')} />
        )} />
        <Controller control={form.control} name="txjuros" render={({ field }) => (
          <NumberField label="Juros (%)" value={field.value as number | undefined} onChange={field.onChange} decimais={2} min={0} disabled={trava('txjuros')} />
        )} />
        <Controller control={form.control} name="nrodup" render={({ field }) => (
          <NumberField label="Parcelas" value={field.value as number | undefined} onChange={field.onChange} decimais={0} min={1} disabled={trava('nrodup')} />
        )} />
      </div>
      <div className="mt-form-gap grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-5">
        {/* edtNRPARCELA ('i/N'; '1/1' no título único) e o fornecedor CEDENTE do boleto (edtCodParceiroCedente — vale para o documento inteiro) */}
        <Field label="Nº parcela" maxLength={10} placeholder="1/1" {...form.register('nrparcela')} />
        <Controller control={form.control} name="codparceirocedente" render={({ field }) => (
          <div className="col-span-2 lg:col-span-3">
            <LookupField label="Fornecedor cedente (boleto)" recurso="lookup/parceiros" campoCodigo="codparceiro" descricao="razao" fixos={{ ativado: 'S' }}
              value={field.value as number | undefined} onChange={(cod) => field.onChange(cod ? Number(cod) : 0)} disabled={!editavel} />
          </div>
        )} />
      </div>
      <div className="mt-form-gap grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-5">
        {/* o desconto e os embutidos do título (edtDesconto/edtVendor): com LANCAR_CENTROCUSTO_DESCACREJRS_CONTAS_PAGAR viram
            linhas próprias no rateio; sem ela, entram no rateio dos centros de custo */}
        <Controller control={form.control} name="desconto" render={({ field }) => (
          <CurrencyField label="Desconto" value={field.value as number | undefined} onChange={field.onChange} />
        )} />
        <Controller control={form.control} name="vendor" render={({ field }) => (
          <CurrencyField label="E&mbutidos (acréscimo)" value={field.value as number | undefined} onChange={field.onChange} />
        )} />
      </div>
      <div className="mt-form-gap grid grid-cols-1 gap-form-gap sm:grid-cols-2 lg:grid-cols-3">
        {/* uAPagar.pas:6129 — GET_BANCOS, sem filtro */}
        <Controller control={form.control} name="codbco" render={({ field }) => (
          <LookupField label="Banc&o" recurso="lookup/bancos" campoCodigo="codigo" descricao="banco" value={field.value as number | undefined}
            onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)} disabled={!editavel} />
        )} />
        {/* uAPagar.pas:771-778 — GET_PLC; o filtro do legado (comprimento da máscara, TIPO_CONTA do convênio, CODIGO IN da situação)
            não é igualdade: fica no servidor */}
        <Controller control={form.control} name="codplc" render={({ field }) => (
          // uAPagar.pas:771-778 — a conta no tamanho da máscara da empresa e os centros da situação do documento
          <LookupField label="Ce&ntro de custo" recurso="lookup/plc" statusTela={{ pai: 'frmAPagar', retorno: 'edtCodPLC' }} campoDigitado="desccodplc" campoCodigo="codplc" descricao={descPlc} value={field.value as number | undefined}
            parametros={{ lancavel: 'S', idsituacao_nf: form.watch('idsituacao_nf' as any) }}
            onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)} disabled={!editavel || trava('codplc')} />
        )} />
        <Controller control={form.control} name="idsituacao_nf" render={({ field }) => (
          <SelectField label="&Situação (natureza)" options={opts.situacaoOptions} value={field.value != null ? String(field.value) : undefined} onChange={(v) => field.onChange(v ? Number(v) : undefined)} placeholder="Opcional…" />
        )} />
      </div>
      <div className="mt-form-gap">
        <TextArea label="Observações" rows={2} disabled={trava('obs')} {...form.register('obs')} />
      </div>
    </fieldset>
  );
}
