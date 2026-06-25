import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import {
  bairroSchema,
  REGIAO_BAIRRO,
  ATIVO_SN,
  type CriarBairroDto,
} from '@apollo/shared';

/**
 * Cadastro de Bairros — 1ª tela HERDEIRA COMPLETA via o pilar <CadMaster>.
 * A tela é só título + recurso + campos (texto + 2 combos). Todo o resto
 * (máquina de estados, código+Enter, Pesquisa com F6, navegação por setas,
 * gravar/excluir com mnemônicos, soft-delete, histórico) vem do pilar/engine.
 */
export function BairrosCadMaster() {
  // LOOKUP/FK: opções de cidade vêm do recurso cadastro/cidades (outra entidade)
  const { data: cidadeOptions = [] } = useResourceOptions('cadastro/cidades', (c: any) => ({
    value: String(c.idcidade),
    label: `${c.cidade}`,
  }));
  return (
    <CadMaster<CriarBairroDto>
      titulo="Bairros"
      resourcePath="cadastro/bairros"
      pk="idbairro"
      colunasPesquisa={[
        { campo: 'idbairro', label: 'Código' },
        { campo: 'descricao', label: 'Descrição' },
        { campo: 'regiao', label: 'Região' },
        { campo: 'ativo', label: 'Ativo' },
      ]}
      schema={bairroSchema}
      defaultValues={{ descricao: '', regiao: undefined, ativo: 'S', idcidade: undefined }}
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
            name="regiao"
            render={({ field }) => (
              <SelectField
                label="&Região"
                options={REGIAO_BAIRRO}
                value={field.value ?? undefined}
                onChange={field.onChange}
                placeholder="Selecione a região…"
                error={form.formState.errors.regiao?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="idcidade"
            render={({ field }) => (
              <SelectField
                label="&Cidade"
                options={cidadeOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Selecione a cidade…"
                error={form.formState.errors.idcidade?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="ativo"
            render={({ field }) => (
              <SelectField
                label="&Ativo"
                options={ATIVO_SN}
                value={field.value ?? 'S'}
                onChange={field.onChange}
              />
            )}
          />
        </div>
      )}
    />
  );
}
