import { Controller, type UseFormReturn } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { UFS, empresaSchema, type CriarEmpresaDto } from '@apollo/shared';

const UF_SIGLA_OPCOES = UFS.map((u) => ({ value: u.sigla, label: `${u.sigla} — ${u.nome}` }));
const CLASSFISCAL_OPCOES = [
  { value: 'LR', label: 'Lucro Real' },
  { value: 'SN', label: 'Simples Nacional' },
];
const FIGURAFISCAL_OPCOES = [
  { value: 'D', label: 'D — Distribuidor' },
  { value: 'O', label: 'O — Outros' },
];
const SN_OPCOES = [
  { value: 'S', label: 'Sim' },
  { value: 'N', label: 'Não' },
];
const AMBIENTE_OPCOES = [
  { value: '1', label: 'Produção' },
  { value: '2', label: 'Homologação' },
];

/** campo numérico (percentual/valor) ligado ao form via Controller. */
function NumCampo({ form, name, label, decimais = 2 }: { form: UseFormReturn<CriarEmpresaDto>; name: keyof CriarEmpresaDto; label: string; decimais?: number }) {
  return (
    <Controller
      control={form.control}
      name={name as never}
      render={({ field }) => (
        <NumberField
          label={label}
          value={field.value as number | undefined}
          onChange={(v) => field.onChange(v)}
          decimais={decimais}
          error={(form.formState.errors as Record<string, { message?: string }>)[name as string]?.message}
        />
      )}
    />
  );
}

/** campo select ligado ao form via Controller. */
function SelCampo({ form, name, label, options, placeholder }: { form: UseFormReturn<CriarEmpresaDto>; name: keyof CriarEmpresaDto; label: string; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <Controller
      control={form.control}
      name={name as never}
      render={({ field }) => (
        <SelectField
          label={label}
          options={options}
          value={field.value != null ? String(field.value) : undefined}
          onChange={(v) => field.onChange(v || undefined)}
          placeholder={placeholder}
          error={(form.formState.errors as Record<string, { message?: string }>)[name as string]?.message}
        />
      )}
    />
  );
}

/**
 * Cadastro de EMPRESAS via <CadMaster> (corte 1). A empresa É o tenant: `idempresa` (= CODEMPRESA)
 * é DIGITADO (chave natural). Seções: Identificação/Endereço, Fiscal (regime/figura/IE/série),
 * Precificação/Financeiro. Adiado (dossiê): certificado/NFC-e/CTe/integrações/e-mail/contábil.
 */
export function EmpresasCadMaster() {
  return (
    <CadMaster<CriarEmpresaDto>
      titulo="Empresas"
      resourcePath="cadastro/empresas"
      pk="idempresa"
      pkGerada={false}
      colunasPesquisa={[
        { campo: 'idempresa', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'razao_social', label: 'Razão social', tipo: 'text' },
        { campo: 'cnpj', label: 'CNPJ', tipo: 'text', largura: 160 },
        { campo: 'uf', label: 'UF', tipo: 'text', largura: 80 },
        { campo: 'classfiscal', label: 'Regime', tipo: 'text', largura: 100 },
      ]}
      schema={empresaSchema}
      defaultValues={{ classfiscal: 'LR', razao_social: '', cnpj: '' } as Partial<CriarEmpresaDto>}
      campos={({ form, editavel }) => {
        const err = (n: string) => (form.formState.errors as Record<string, { message?: string }>)[n]?.message;
        return (
          <div className="flex flex-col gap-form-gap">
            {/* Identificação */}
            <fieldset className="rounded-radius-md border border-border p-pad-md">
              <legend className="px-pad-xs text-fg-muted">Identificação</legend>
              <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
                <NumCampo form={form} name="idempresa" label="&Código" decimais={0} />
                <div className="sm:col-span-2">
                  <Field label="&Razão social" disabled={!editavel} error={err('razao_social')} {...form.register('razao_social')} />
                </div>
                <Field label="&Fantasia" disabled={!editavel} error={err('fantasia')} {...form.register('fantasia')} />
                <Field label="C&NPJ" disabled={!editavel} error={err('cnpj')} {...form.register('cnpj')} />
                <Field label="&IE (Inscrição Estadual)" disabled={!editavel} error={err('insc')} {...form.register('insc')} />
                <Field label="Inscrição &Municipal" disabled={!editavel} error={err('im')} {...form.register('im')} />
                <Field label="&Telefone" disabled={!editavel} error={err('fone1')} {...form.register('fone1')} />
              </div>
            </fieldset>

            {/* Endereço */}
            <fieldset className="rounded-radius-md border border-border p-pad-md">
              <legend className="px-pad-xs text-fg-muted">Endereço</legend>
              <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Field label="&Endereço" disabled={!editavel} error={err('endereco')} {...form.register('endereco')} />
                </div>
                <Field label="Nú&mero" disabled={!editavel} error={err('numero')} {...form.register('numero')} />
                <Field label="Com&plemento" disabled={!editavel} error={err('complemento')} {...form.register('complemento')} />
                <Field label="&Bairro" disabled={!editavel} error={err('bairro')} {...form.register('bairro')} />
                <Field label="C&idade" disabled={!editavel} error={err('cidade')} {...form.register('cidade')} />
                <SelCampo form={form} name="uf" label="&UF" options={UF_SIGLA_OPCOES} placeholder="Selecione…" />
                <Field label="CE&P" disabled={!editavel} error={err('cep')} {...form.register('cep')} />
                <NumCampo form={form} name="idcidade" label="Código IBGE (cM&un)" decimais={0} />
              </div>
            </fieldset>

            {/* Fiscal */}
            <fieldset className="rounded-radius-md border border-border p-pad-md">
              <legend className="px-pad-xs text-fg-muted">Fiscal</legend>
              <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
                <SelCampo form={form} name="classfiscal" label="&Regime" options={CLASSFISCAL_OPCOES} placeholder="Selecione…" />
                <SelCampo form={form} name="figurafiscal" label="Figura &fiscal" options={FIGURAFISCAL_OPCOES} placeholder="—" />
                <SelCampo form={form} name="contribuinte_icms" label="Contribuinte &ICMS" options={SN_OPCOES} placeholder="—" />
                <NumCampo form={form} name="alqsimplesnac" label="Alíq. Simples &Nac. (%)" />
                <Field label="&Série NF-e" disabled={!editavel} error={err('serie_nfe')} {...form.register('serie_nfe')} />
                <SelCampo form={form} name="ambiente" label="&Ambiente" options={AMBIENTE_OPCOES} placeholder="—" />
                <NumCampo form={form} name="aliquota_estado" label="Alíq. estadual (%)" />
              </div>
            </fieldset>

            {/* Precificação / financeiro */}
            <fieldset className="rounded-radius-md border border-border p-pad-md">
              <legend className="px-pad-xs text-fg-muted">Precificação / financeiro</legend>
              <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
                <NumCampo form={form} name="despoperacional" label="Desp. &operacional (%)" />
                <NumCampo form={form} name="margem_venda" label="Margem de &venda (%)" />
                <NumCampo form={form} name="margem_contribuicao" label="Margem de &contribuição (%)" />
                <NumCampo form={form} name="txjuropadrao" label="&Taxa de juro padrão (%)" />
                <NumCampo form={form} name="tx_juro_apagar" label="Taxa juro a pagar (%)" />
                <NumCampo form={form} name="descmax" label="&Desconto máx. (%)" />
                <NumCampo form={form} name="limite_descmax" label="&Limite desc. máx. (%)" />
              </div>
            </fieldset>
          </div>
        );
      }}
    />
  );
}
