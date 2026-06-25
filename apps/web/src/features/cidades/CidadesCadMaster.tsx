import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { cidadeSchema, UF_OPCOES, type CriarCidadeDto } from '@apollo/shared';

/**
 * Cadastro de CIDADES via <CadMaster> — chave natural (IDCIDADE/IBGE digitado).
 * `iduf` é FK p/ UF → LOOKUP que mostra a SIGLA/nome (não o número cru): SelectField
 * com UF_OPCOES (lista fixa IBGE). Serve de alvo do lookup de Bairros.
 */
export function CidadesCadMaster() {
  return (
    <CadMaster<CriarCidadeDto>
      titulo="Cidades"
      resourcePath="cadastro/cidades"
      pk="idcidade"
      pkGerada={false}
      colunasPesquisa={[
        { campo: 'idcidade', label: 'IBGE', tipo: 'text', largura: 120 },
        { campo: 'cidade', label: 'Cidade', tipo: 'text' },
        { campo: 'uf', label: 'UF', tipo: 'text', largura: 90 },
      ]}
      schema={cidadeSchema}
      defaultValues={{ cidade: '', iduf: undefined }}
      campos={({ form, editavel }) => (
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="&Cidade"
              disabled={!editavel}
              error={form.formState.errors.cidade?.message as string | undefined}
              {...form.register('cidade')}
            />
          </div>
          <Controller
            control={form.control}
            name="iduf"
            render={({ field }) => (
              <SelectField
                label="&UF"
                options={UF_OPCOES}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Selecione a UF…"
                error={form.formState.errors.iduf?.message as string | undefined}
              />
            )}
          />
        </div>
      )}
    />
  );
}
