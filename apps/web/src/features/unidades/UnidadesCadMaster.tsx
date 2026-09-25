import { Controller } from 'react-hook-form';
import { unidadeSchema, type CriarUnidadeDto } from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { CheckboxField } from '../../shared/ui/CheckboxField';

/** Cadastro de unidades (UCadUnidade): sigla única, descrição, ativo, produção e fracionado; excluir recusa unidade usada por produto. */
export function UnidadesCadMaster() {
  return (
    <CadMaster<CriarUnidadeDto>
      titulo="Unidades"
      resourcePath="cadastro/unidades"
      pk="codunidade"
      viewPk="codigo"
      log={{ form: 'FRMCADUNIDADE', chave: 'CODUNIDADE' }}
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'sigla', label: 'Sigla', tipo: 'text', largura: 100 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
      ]}
      schema={unidadeSchema}
      defaultValues={{ sigla: '', descricao: '', ativo: 'S' }}
      campos={({ form, editavel }) => (
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
          <Field label="&Sigla" disabled={!editavel} maxLength={2} error={form.formState.errors.sigla?.message as string | undefined} {...form.register('sigla')} />
          <div className="sm:col-span-2">
            <Field label="&Descrição" disabled={!editavel} maxLength={15} {...form.register('descricao')} />
          </div>
          {([['ativo', 'Ativo'], ['producao', 'Produção'], ['fracionado', 'Fracionado']] as const).map(([name, label]) => (
            <Controller key={name} control={form.control} name={name} render={({ field }) => (
              <CheckboxField label={label} value={(field.value as string | undefined) ?? 'N'} onChange={field.onChange} disabled={!editavel} />
            )} />
          ))}
        </div>
      )}
    />
  );
}
