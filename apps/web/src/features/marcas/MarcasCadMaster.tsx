import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { marcaSchema, type CriarMarcaDto } from '@apollo/shared';

/**
 * Cadastro de Marcas via o shell CadMaster — a tela é só título + recurso + campos.
 * Tudo o mais (máquina de estados, botões, carregar-por-código, teclado) vem do pilar.
 */
export function MarcasCadMaster() {
  return (
    <CadMaster<CriarMarcaDto>
      titulo="Marcas"
      resourcePath="cadastro/marcas"
      pk="idmarca"
      viewPk="codigo" // get_marcas expõe a PK como 'codigo'
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código' },
        { campo: 'descricao', label: 'Descrição' },
      ]}
      schema={marcaSchema}
      defaultValues={{ descricao: '' }}
      campos={({ form, editavel }) => (
        <Field
          label="&Descrição"
          disabled={!editavel}
          error={form.formState.errors.descricao?.message as string | undefined}
          {...form.register('descricao')}
        />
      )}
    />
  );
}
