import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { DateField } from '../../shared/ui/DateField';
import { TextArea } from '../../shared/ui/TextArea';
import { ncmSchema, type CriarNcmDto } from '@apollo/shared';

/**
 * Cadastro de NCM via o pilar <CadMaster> — CHAVE NATURAL (o código NCM é digitado,
 * pkGerada={false}) + palette de data (vigências) e memo (descrição/observação).
 */
export function NcmCadMaster() {
  return (
    <CadMaster<CriarNcmDto>
      titulo="NCM"
      resourcePath="cadastro/ncm"
      pk="codigo"
      pkGerada={false} // chave natural: usuário digita o código NCM
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código' },
        { campo: 'ncmsh', label: 'NCM' },
        { campo: 'descricao', label: 'Descrição' },
      ]}
      schema={ncmSchema}
      defaultValues={{ ncmsh: '', descricao: '', ipi: '', observacao: '' }}
      campos={({ form, editavel }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field
            label="&NCM (formatado)"
            disabled={!editavel}
            error={form.formState.errors.ncmsh?.message as string | undefined}
            {...form.register('ncmsh')}
          />
          <TextArea
            label="&Descrição"
            disabled={!editavel}
            error={form.formState.errors.descricao?.message as string | undefined}
            {...form.register('descricao')}
          />
          <Field
            label="&IPI"
            disabled={!editavel}
            error={form.formState.errors.ipi?.message as string | undefined}
            {...form.register('ipi')}
          />
          <div style={{ display: 'flex', gap: 12 }}>
            <Controller
              control={form.control}
              name="vigencia_inicio"
              render={({ field }) => (
                <DateField
                  label="Vigência &Início"
                  value={field.value as string | undefined}
                  onChange={field.onChange}
                  disabled={!editavel}
                />
              )}
            />
            <Controller
              control={form.control}
              name="vigencia_fim"
              render={({ field }) => (
                <DateField
                  label="Vigência &Fim"
                  value={field.value as string | undefined}
                  onChange={field.onChange}
                  disabled={!editavel}
                />
              )}
            />
          </div>
          <TextArea
            label="&Observação"
            disabled={!editavel}
            error={form.formState.errors.observacao?.message as string | undefined}
            {...form.register('observacao')}
          />
        </div>
      )}
    />
  );
}
