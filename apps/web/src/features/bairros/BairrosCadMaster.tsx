import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { LookupField } from '../../shared/ui/LookupField';
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
  return (
    <CadMaster<CriarBairroDto>
      titulo="Bairros"
      resourcePath="cadastro/bairros"
      pk="idbairro"
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código', tipo: 'text', largura: 90 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
        { campo: 'regiao', label: 'Região', tipo: 'text', largura: 140 },
        { campo: 'ativo', label: 'Ativo', tipo: 'text', largura: 90 },
      ]}
      schema={bairroSchema}
      defaultValues={{ descricao: '', regiao: undefined, ativo: 'S', idcidade: undefined }}
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
          {/* LOOKUP de cidade (GET_CIDADES): a tela é nova (uCadBairros.md — não há form legado), então sem filtro do campo */}
          <div className="sm:col-span-2">
            <Controller
              control={form.control}
              name="idcidade"
              render={({ field }) => (
                <LookupField
                  label="&Cidade"
                  recurso="lookup/cidades"
                  campoCodigo="idcidade"
                  descricao="cidade"
                  value={field.value as number | undefined}
                  onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)}
                  error={form.formState.errors.idcidade?.message as string | undefined}
                  disabled={!editavel}
                />
              )}
            />
          </div>
        </div>
      )}
    />
  );
}
