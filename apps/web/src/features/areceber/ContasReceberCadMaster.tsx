import { useMemo, useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { areceberSchema, AR_TIPODOC_OPCOES, type CriarAreceberDto } from '@apollo/shared';
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

const hojeISO = () => hojeNaLoja();
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
      log={{ form: 'FRMCADARECEBER', chave: 'CODRCB' }}
      schema={areceberSchema}
      defaultValues={defaultValues}
      largura="5xl"
      gerenciaEdicaoInterna
      colunasPesquisa={[
        { campo: 'codrcb', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'duplicata', label: 'Duplicata', tipo: 'text', largura: 140 },
        { campo: 'razao', label: 'Cliente', tipo: 'text' },
        { campo: 'dtvenc', label: 'Vencimento', tipo: 'date', largura: 130 },
        { campo: 'valor', label: 'Valor', tipo: 'text', largura: 120 },
        { campo: 'quitada', label: 'Quitada', tipo: 'text', largura: 90 },
      ]}
      campos={({ form, editavel }) => (
        <ArForm
          form={form}
          editavel={editavel}
          opts={{ situacaoOptions }}
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
}: {
  form: UseFormReturn<CriarAreceberDto>;
  editavel: boolean;
  opts: LookupOptions;
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

  const tabs: TabDef[] = [
    { id: 'cadastro', label: 'Cadastro' },
    { id: 'historico', label: 'Histórico', disabled: true },
    { id: 'pendencias', label: 'Pendências', disabled: true },
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
      <BaixaSection form={form} />
      <div>
        <Tabs tabs={tabs} active={aba} onChange={setAba} />
        <TabPanel>
          {aba === 'cadastro' && <CadastroTab form={form} editavel={liberado} opts={opts} bloqueados={bloqueados} />}
          {(aba === 'historico' || aba === 'pendencias') && (
            <div className="flex min-h-24 flex-col items-center justify-center gap-gp-xs text-center text-fg-muted">
              <span className="text-body-sm font-semibold text-fg-default">{tabs.find((t) => t.id === aba)?.label}</span>
              <small>Aba do legado — conteúdo previsto para fase futura (baixa/estorno = corte-2; dossiê §10).</small>
            </div>
          )}
        </TabPanel>
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

function CadastroTab({
  form,
  editavel,
  opts,
  bloqueados,
}: {
  form: UseFormReturn<CriarAreceberDto>;
  editavel: boolean;
  opts: LookupOptions;
  bloqueados: Set<string>;
}) {
  const err = form.formState.errors;
  const trava = (campo: string) => bloqueados.has(campo);
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
            // uCadAReceber.pas:547-553 — GET_PLC, TIPO_CONTA='RECEITA' (= TPCONTA 0 na GET_PLC da produção); o comprimento da máscara e o
            // CODIGO IN da situação não são igualdade: ficam no servidor
            <LookupField label="Centro de custo" recurso="lookup/plc" campoDigitado="desccodplc" campoCodigo="codplc" descricao={descPlc} fixos={{ tpconta: 0 }}
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
