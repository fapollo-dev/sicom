import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { motivoOperacaoSchema, type CriarMotivoOperacaoDto } from '@apollo/shared';

/**
 * Cadastro de Motivos de Operação (lookup do Ajuste de Estoque) via <CadMaster> — molde marcas.
 */
export function MotivosOperacaoCadMaster() {
  return (
    <CadMaster<CriarMotivoOperacaoDto>
      titulo="Motivos de Operação"
      resourcePath="cadastro/motivos-operacao"
      pk="codmotivoop"
      viewPk="codigo"
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
        { campo: 'tipo_operacao', label: 'Tipo', tipo: 'text', largura: 140 },
      ]}
      schema={motivoOperacaoSchema}
      defaultValues={{ descricao: '', tipo_operacao: '' }}
      campos={({ form, editavel }) => (
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="&Descrição"
              maxLength={60}
              disabled={!editavel}
              error={form.formState.errors.descricao?.message as string | undefined}
              {...form.register('descricao')}
            />
          </div>
          <Field label="&Tipo de operação" maxLength={20} disabled={!editavel} {...form.register('tipo_operacao')} />
        </div>
      )}
    />
  );
}
