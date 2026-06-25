import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { tabelaPrecoSchema, type CriarTabelaPrecoDto } from '@apollo/shared';

/**
 * Cadastro de PRECO (Tabela de Reajuste) via o pilar <CadMaster> — texto (Descrição)
 * + MOEDA (Valor do Reajuste, CurrencyField formatado R$, sem spinner) + 2 flags S/N
 * (Reajuste, Ativo) como checkbox. Layout em grid (showcase). Tudo o mais do pilar/engine.
 */
export function PrecosCadMaster() {
  return (
    <CadMaster<CriarTabelaPrecoDto>
      titulo="Tabela de Reajuste de Preço"
      resourcePath="cadastro/precos"
      pk="id_preco"
      colunasPesquisa={[
        { campo: 'id_preco', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
        { campo: 'valor_reajuste', label: 'Valor', tipo: 'currency', largura: 160 },
      ]}
      schema={tabelaPrecoSchema}
      defaultValues={{ descricao: '', valor_reajuste: undefined, reajuste: 'N', ativo: 'S' }}
      campos={({ form, editavel }) => (
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="&Descrição"
              disabled={!editavel}
              error={form.formState.errors.descricao?.message as string | undefined}
              {...form.register('descricao')}
            />
          </div>
          <Controller
            control={form.control}
            name="valor_reajuste"
            render={({ field }) => (
              <CurrencyField
                label="&Valor do Reajuste"
                value={field.value as number | undefined}
                onChange={field.onChange}
                disabled={!editavel}
                error={form.formState.errors.valor_reajuste?.message as string | undefined}
              />
            )}
          />
          <div className="flex items-center gap-gp-lg sm:col-span-2">
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
