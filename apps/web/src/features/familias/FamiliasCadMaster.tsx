import { Controller } from 'react-hook-form';
import { familiaSchema, FAMILIA_TIPO_OPCOES, type CriarFamiliaDto } from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { LookupField } from '../../shared/ui/LookupField';

/**
 * Cadastro de categorias e departamentos (UCadFamiliaProd) — o catálogo único das famílias de produto. O TIPO decide a aba (cbbTIPOExit):
 * o departamento tem o perfil de compra, o grupo a comissão, o subgrupo pendura em seção/departamento/grupo/setor (cada um do seu tipo e
 * ativo — a regra mora no gravar) e o setor pode ser o de perda padrão (um só). Excluir é lógico e recusado se algum produto usa a família.
 */
export function FamiliasCadMaster() {
  const { data: perfis = [] } = useResourceOptions('cadastro/perfil', (p: any) => ({ value: String(p.codperfil), label: `${p.codperfil} - ${p.perfil ?? p.descricao ?? ''}` }),
    { campo: 'tipo', operador: 'igual', valor: 'COMPRA' });

  const codigo = (form: any, name: keyof CriarFamiliaDto, label: string, options: Array<{ value: string; label: string }>, editavel: boolean) => (
    <Controller control={form.control} name={name as never} render={({ field }: any) => (
      <SelectField label={label} options={options} disabled={!editavel} value={field.value != null && field.value !== '' ? String(field.value) : undefined}
        onChange={(v) => field.onChange(v ? Number(v) : '')} placeholder="Selecione…" />
    )} />
  );
  /**
   * a família de um tipo (UCadFamiliaProd.pas:220-222 departamento, 236-238 grupo, 245-247 seção, 254-260 setor): GET_FAMILIAS_PROD com
   * TIPO = o tipo (o decode da view da produção: D/G/O/E) AND ATIVO='S'. O `CODEMPRESA = a loja` do legado não cabe: a get_familias_prod
   * do destino não tem a coluna da empresa (vai ao servidor).
   */
  const familia = (form: any, name: keyof CriarFamiliaDto, label: string, tipo: string, editavel: boolean) => (
    <Controller control={form.control} name={name as never} render={({ field }: any) => (
      <LookupField label={label} recurso="lookup/familias" campoCodigo="codfamilia" descricao="descricao" fixos={{ tipo, ativo: 'S' }} parametros={{ daLoja: 'S' }}
        value={field.value != null && field.value !== '' ? String(field.value) : undefined}
        onChange={(cod) => field.onChange(cod ? Number(cod) : '')} disabled={!editavel} />
    )} />
  );
  const numero = (form: any, name: keyof CriarFamiliaDto, label: string, editavel: boolean, decimais = 2) => (
    <Controller control={form.control} name={name as never} render={({ field }: any) => (
      <NumberField label={label} value={field.value != null && field.value !== '' ? Number(field.value) : undefined} onChange={field.onChange} decimais={decimais} disabled={!editavel} />
    )} />
  );
  const flag = (form: any, name: keyof CriarFamiliaDto, label: string, editavel: boolean) => (
    <Controller control={form.control} name={name as never} render={({ field }: any) => (
      <CheckboxField label={label} value={(field.value as string | undefined) ?? 'N'} onChange={field.onChange} disabled={!editavel} />
    )} />
  );

  return (
    <CadMaster<CriarFamiliaDto>
      titulo="Categorias e departamentos"
      resourcePath="cadastro/familias"
      pk="codfamilia"
      viewPk="codigo"
      log={{ form: 'FRMCADFAMILIAPROD', chave: 'CODFAMILIA' }}
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
        { campo: 'tipo', label: 'Tipo', tipo: 'text', largura: 80 },
        { campo: 'ativo', label: 'Ativo', tipo: 'status', largura: 90 },
      ]}
      schema={familiaSchema}
      defaultValues={{ tipo: 'D', descricao: '', ativo: 'S' }}
      campos={({ form, editavel }) => {
        const tipo = form.watch('tipo');
        return (
          <div className="flex flex-col gap-form-gap">
            <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Field label="Descrição" disabled={!editavel} error={form.formState.errors.descricao?.message as string | undefined} {...form.register('descricao')} />
              </div>
              <Controller control={form.control} name="tipo" render={({ field }) => (
                <SelectField label="Tipo" options={FAMILIA_TIPO_OPCOES} value={field.value ?? undefined} onChange={(v) => field.onChange(v || 'D')} disabled={!editavel} />
              )} />
              {/* UCadFamiliaProd.pas:209-211 — GET_PLC; o filtro do legado (comprimento da máscara) não é igualdade: fica no servidor */}
              <Controller control={form.control} name="codplc" render={({ field }) => (
                <LookupField label="Centro de custo de perdas" recurso="lookup/plc" campoDigitado="desccodplc" parametros={{ lancavel: 'S' }} campoCodigo="codplc"
                  descricao={(l) => `${l.desccodplc ?? l.codplc} - ${l.descricao ?? ''}`}
                  value={field.value != null && (field.value as unknown) !== '' ? String(field.value) : undefined}
                  onChange={(cod) => field.onChange(cod ? Number(cod) : '')} disabled={!editavel} />
              )} />
              {flag(form, 'ativo', 'Ativo', editavel)}
            </div>
            {tipo === 'D' && (
              <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
                <legend className="px-pad-xs text-fg-muted">Departamento</legend>
                {codigo(form, 'codperfil_compra', 'Perfil de compra', perfis, editavel)}
              </fieldset>
            )}
            {tipo === 'G' && (
              <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
                <legend className="px-pad-xs text-fg-muted">Grupo</legend>
                {numero(form, 'comissao', 'Comissão (%)', editavel)}
              </fieldset>
            )}
            {tipo === 'S' && (
              <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
                <legend className="px-pad-xs text-fg-muted">Subgrupo</legend>
                <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
                  {familia(form, 'codsecao', 'Seção', 'O', editavel)}
                  {familia(form, 'coddpto', 'Departamento', 'D', editavel)}
                  {familia(form, 'codgrupo', 'Grupo', 'G', editavel)}
                  {familia(form, 'codsetor', 'Setor', 'E', editavel)}
                  {numero(form, 'coberturamaxima', 'Cobertura máxima', editavel, 0)}
                  {flag(form, 'exibesicomanda', 'Exibe no SICOMANDA', editavel)}
                </div>
              </fieldset>
            )}
            {tipo === 'E' && (
              <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
                <legend className="px-pad-xs text-fg-muted">Setor</legend>
                {flag(form, 'codsetor_perda_padrao', 'Definir como setor de perda padrão', editavel)}
              </fieldset>
            )}
            <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
              <legend className="px-pad-xs text-fg-muted">Outros</legend>
              <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
                {numero(form, 'vrmargemmin', 'Margem mínima', editavel)}
                {numero(form, 'vrmargemmax', 'Margem máxima', editavel)}
                {numero(form, 'vrmargemfixa', 'Margem fixa', editavel)}
                {numero(form, 'fp_despesa_operacional', 'Despesa operacional (%)', editavel)}
                <Field label="Referência" disabled={!editavel} maxLength={15} {...form.register('referencia')} />
                <Field label="Checkout" disabled={!editavel} maxLength={1} {...form.register('checkout')} />
                <div className="sm:col-span-2">
                  <Field label="Modelo de etiqueta" disabled={!editavel} maxLength={200} {...form.register('modeloeitqueta')} />
                </div>
                {flag(form, 'desconsidera_conferencia_peso', 'Desconsidera a conferência de peso', editavel)}
              </div>
            </fieldset>
          </div>
        );
      }}
    />
  );
}
