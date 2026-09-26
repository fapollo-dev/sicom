import { Controller, type UseFormReturn } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { UFS, empresaSchema, EMPRESA_CAMPOS_LEGADO, type CriarEmpresaDto } from '@apollo/shared';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { DateField } from '../../shared/ui/DateField';

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

/** ISO do servidor → valor do <input type="datetime-local"> no fuso do navegador */
const paraLocal = (iso: unknown) => {
  if (!iso) return '';
  const d = new Date(String(iso instanceof Date ? iso.toISOString() : iso));
  if (Number.isNaN(d.getTime())) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** as abas do legado com os campos que a tela não tinha (`empresa-legado.ts`), na ordem das abas do UCadEmpresa */
const ABAS_LEGADO = Array.from(new Set(EMPRESA_CAMPOS_LEGADO.map((c) => c.aba)));

/** os campos do UCadEmpresa (e do binário novo) por aba — recolhidos; segredos não voltam na leitura (digite para trocar) */
function CamposLegado({ form, editavel }: { form: UseFormReturn<CriarEmpresaDto>; editavel: boolean }) {
  return (
    <div className="flex flex-col gap-form-gap">
      {ABAS_LEGADO.map((aba) => (
        <details key={aba} className="rounded-radius-md border border-border p-pad-md">
          <summary className="cursor-pointer text-fg-muted">{aba}</summary>
          <div className="mt-pad-sm grid grid-cols-1 gap-form-gap sm:grid-cols-3">
            {EMPRESA_CAMPOS_LEGADO.filter((c) => c.aba === aba).map((c) => (
              <Controller
                key={c.coluna}
                control={form.control}
                name={c.coluna as never}
                render={({ field }: any) => {
                  if (c.tipo === 'sn') return <CheckboxField label={c.rotulo} value={(field.value as string | undefined) ?? 'N'} onChange={field.onChange} disabled={!editavel} />;
                  if (c.tipo === 'inteiro' || c.tipo === 'numero') {
                    return <NumberField label={c.rotulo} value={field.value != null && field.value !== '' ? Number(field.value) : undefined} onChange={field.onChange} decimais={c.tipo === 'inteiro' ? 0 : 4} disabled={!editavel} />;
                  }
                  if (c.tipo === 'opcao') {
                    return <SelectField label={c.rotulo} options={(c.opcoes ?? []).map(([value, label]) => ({ value, label }))} value={field.value != null && field.value !== '' ? String(field.value) : undefined} onChange={(v) => field.onChange(v || undefined)} placeholder="—" disabled={!editavel} />;
                  }
                  if (c.tipo === 'data') return <DateField label={c.rotulo} value={field.value ? String(field.value).slice(0, 10) : undefined} onChange={field.onChange} disabled={!editavel} />;
                  if (c.tipo === 'datahora') {
                    // datetime-local é hora de parede sem fuso: mostra no fuso do navegador e grava ISO com offset
                    return (
                      <label className="flex flex-col gap-gp-2xs text-body-sm">
                        <span className="text-fg-muted">{c.rotulo}</span>
                        <input type="datetime-local" disabled={!editavel} value={paraLocal(field.value)}
                          className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs"
                          onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value).toISOString() : undefined)} />
                      </label>
                    );
                  }
                  return (
                    <Field label={c.rotulo} disabled={!editavel} maxLength={c.max} type={c.segredo ? 'password' : undefined}
                      placeholder={c.segredo ? 'não exibida — digite para trocar' : undefined} value={(field.value as string | undefined) ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? undefined : e.target.value)} />
                  );
                }}
              />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

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
      log={{ form: 'FRMCADEMPRESA', chave: 'CODEMPRESA' }}
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

            {/* Parâmetros que a operação altera (centros de custo das baixas, curva ABC, área, TEF, PDV) */}
            <fieldset className="rounded-radius-md border border-border p-pad-md">
              <legend className="px-pad-xs text-fg-muted">Parâmetros</legend>
              <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
                <NumCampo form={form} name="ccmultajuros" label="CC multas, juros e taxas" decimais={0} />
                <NumCampo form={form} name="codplc_juros_pagos" label="CC juros pagos" decimais={0} />
                <NumCampo form={form} name="codplc_acrescimos_pagos" label="CC acréscimos pagos" decimais={0} />
                <NumCampo form={form} name="codplc_descontos_recebidos" label="CC descontos recebidos" decimais={0} />
                <NumCampo form={form} name="codplc_descontos_concedidos" label="CC descontos concedidos" decimais={0} />
                <NumCampo form={form} name="codparceiro" label="Parceiro da empresa" decimais={0} />
                <SelCampo form={form} name="sincroniza_preco_nf" label="Sincroniza preço nas lojas" options={SN_OPCOES} placeholder="—" />
                <NumCampo form={form} name="pc_curva_abc_a" label="Curva ABC venda — A (%)" />
                <NumCampo form={form} name="pc_curva_abc_b" label="Curva ABC venda — B (%)" />
                <NumCampo form={form} name="pc_curva_abc_c" label="Curva ABC venda — C (%)" />
                <NumCampo form={form} name="pc_curva_abc_d" label="Curva ABC venda — D (%)" />
                <NumCampo form={form} name="pc_curva_abc_e" label="Curva ABC venda — E (%)" />
                <NumCampo form={form} name="pc_curva_comp_a" label="Curva ABC compra — A (%)" />
                <NumCampo form={form} name="pc_curva_comp_b" label="Curva ABC compra — B (%)" />
                <NumCampo form={form} name="pc_curva_comp_c" label="Curva ABC compra — C (%)" />
                <NumCampo form={form} name="aream2" label="Área (m²)" />
                <NumCampo form={form} name="aream2_venda" label="Área de venda (m²)" />
                <Field label="Junta comercial" disabled={!editavel} error={err('junta_comercial')} {...form.register('junta_comercial')} />
                <Field label="TEF — loja" disabled={!editavel} error={err('tef_loja')} {...form.register('tef_loja')} />
                <Field label="TEF — servidor" disabled={!editavel} error={err('tef_servidor')} {...form.register('tef_servidor')} />
                <NumCampo form={form} name="codplc_nf_pdv" label="CC da NF do PDV" decimais={0} />
                <NumCampo form={form} name="idsituacao_nf_pdv" label="Situação da NF do PDV" decimais={0} />
              </div>
            </fieldset>
            <CamposLegado form={form} editavel={editavel} />
          </div>
        );
      }}
    />
  );
}
