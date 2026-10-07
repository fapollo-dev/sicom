import { useMemo, useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { apagarSchema, AR_TIPODOC_OPCOES, type CriarApagarDto } from '@apollo/shared';
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
      log={{ form: 'FRMAPAGAR', chave: 'CODAPG' }}
      schema={apagarSchema}
      defaultValues={defaultValues}
      largura="5xl"
      gerenciaEdicaoInterna
      colunasPesquisa={[
        { campo: 'codapg', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'duplicata', label: 'Duplicata', tipo: 'text', largura: 140 },
        { campo: 'razao', label: 'Fornecedor', tipo: 'text' },
        { campo: 'dtvenc', label: 'Vencimento', tipo: 'date', largura: 130 },
        { campo: 'valor', label: 'Valor', tipo: 'text', largura: 120 },
        { campo: 'quitada', label: 'Paga', tipo: 'text', largura: 90 },
      ]}
      campos={({ form, editavel }) => (
        <ApForm form={form} editavel={editavel} opts={{ situacaoOptions }} />
      )}
    />
  );
}

type LookupOptions = {
  situacaoOptions: Opcao[];
};

/** o centro de custo como o legado o mostra: o código extenso (DESCCODPLC) e a descrição */
const descPlc = (l: Record<string, any>) => `${l.desccodplc ?? l.codplc} - ${l.descricao ?? ''}`;

function ApForm({ form, editavel, opts }: { form: UseFormReturn<CriarApagarDto>; editavel: boolean; opts: LookupOptions }) {
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

  const tabs: TabDef[] = [
    { id: 'cadastro', label: 'Cadastro' },
    { id: 'historico', label: 'Histórico', disabled: true },
    { id: 'pendencias', label: 'Pendências', disabled: true },
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
      <div>
        <Tabs tabs={tabs} active={aba} onChange={setAba} />
        <TabPanel>
          {aba === 'cadastro' && <CadastroTab form={form} editavel={liberado} opts={opts} bloqueados={bloqueados} />}
          {(aba === 'historico' || aba === 'pendencias') && (
            <div className="flex min-h-24 flex-col items-center justify-center gap-gp-xs text-center text-fg-muted">
              <span className="text-body-sm font-semibold text-fg-default">{tabs.find((t) => t.id === aba)?.label}</span>
              <small>Aba do legado — conteúdo previsto para fase futura (dossiê §10).</small>
            </div>
          )}
        </TabPanel>
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
            <SelectField label="&Tipo de documento" options={AR_TIPODOC_OPCOES as unknown as Opcao[]} value={(field.value as string) ?? undefined} onChange={(v) => field.onChange(v || undefined)} placeholder="Selecione…" />
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
          <LookupField label="Ce&ntro de custo" recurso="lookup/plc" campoDigitado="desccodplc" campoCodigo="codplc" descricao={descPlc} value={field.value as number | undefined}
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
