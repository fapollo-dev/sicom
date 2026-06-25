import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { tabelaPrecoSchema, type CriarTabelaPrecoDto } from '@apollo/shared';

/**
 * Cadastro de PRECO (Tabela de Reajuste) via o pilar <CadMaster> — exercita o
 * PALETTE completo: texto (Descrição) + número/moeda (Valor do Reajuste) + 2 flags
 * S/N (Reajuste, Ativo) como checkbox. Tudo o mais herdado do pilar/engine.
 */
export function PrecosCadMaster() {
  return (
    <CadMaster<CriarTabelaPrecoDto>
      titulo="Tabela de Reajuste de Preço"
      resourcePath="cadastro/precos"
      pk="id_preco"
      colunasPesquisa={[
        { campo: 'id_preco', label: 'Código' },
        { campo: 'descricao', label: 'Descrição' },
        { campo: 'valor_reajuste', label: 'Valor' },
      ]}
      schema={tabelaPrecoSchema}
      defaultValues={{ descricao: '', valor_reajuste: undefined, reajuste: 'N', ativo: 'S' }}
      campos={({ form, editavel }) => (
        <div className="flex flex-col gap-form-gap">
          <Field
            label="&Descrição"
            disabled={!editavel}
            error={form.formState.errors.descricao?.message as string | undefined}
            {...form.register('descricao')}
          />
          <Controller
            control={form.control}
            name="valor_reajuste"
            render={({ field }) => (
              <NumberField
                label="&Valor do Reajuste"
                value={field.value as number | undefined}
                onChange={field.onChange}
                disabled={!editavel}
                error={form.formState.errors.valor_reajuste?.message as string | undefined}
              />
            )}
          />
          <div className="flex gap-gp-lg">
            <Controller
              control={form.control}
              name="reajuste"
              render={({ field }) => (
                <CheckboxField label="&Reajuste" value={field.value} onChange={field.onChange} disabled={!editavel} />
              )}
            />
            <Controller
              control={form.control}
              name="ativo"
              render={({ field }) => (
                <CheckboxField label="&Ativo" value={field.value} onChange={field.onChange} disabled={!editavel} />
              )}
            />
          </div>
        </div>
      )}
    />
  );
}
