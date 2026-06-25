import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { cidadeSchema, type CriarCidadeDto } from '@apollo/shared';

/**
 * Cadastro de CIDADES via <CadMaster> — chave natural (IDCIDADE/IBGE digitado).
 * Tela trivial; serve de alvo do lookup de Bairros.
 */
export function CidadesCadMaster() {
  return (
    <CadMaster<CriarCidadeDto>
      titulo="Cidades"
      resourcePath="cadastro/cidades"
      pk="idcidade"
      pkGerada={false}
      colunasPesquisa={[
        { campo: 'idcidade', label: 'IBGE' },
        { campo: 'cidade', label: 'Cidade' },
        { campo: 'iduf', label: 'UF' },
      ]}
      schema={cidadeSchema}
      defaultValues={{ cidade: '', iduf: undefined }}
      campos={({ form, editavel }) => (
        <div className="flex flex-col gap-form-gap">
          <Field
            label="&Cidade"
            disabled={!editavel}
            error={form.formState.errors.cidade?.message as string | undefined}
            {...form.register('cidade')}
          />
          <Field
            label="&UF (id)"
            type="number"
            disabled={!editavel}
            error={form.formState.errors.iduf?.message as string | undefined}
            {...form.register('iduf', { valueAsNumber: true })}
          />
        </div>
      )}
    />
  );
}
