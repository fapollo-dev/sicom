import { CadMasterDet } from '../../shared/cadmaster/CadMasterDet';
import { Field } from '../../shared/ui/Field';
import { loteCobrancaSchema, type CriarLoteCobrancaDto } from '@apollo/shared';

/**
 * Lote de Cobrança via o shell MESTRE-DETALHE <CadMasterDet> — header (parceiro,
 * data) + itens (contas a receber). Prova o pilar no tier agregado: a tela é só
 * header + linha-de-item; gravação/cascata/transação vêm do AggregateEngineService.
 */
export function LotesCobrancaCadMaster() {
  return (
    <CadMasterDet<CriarLoteCobrancaDto>
      titulo="Lote de Cobrança"
      resourcePath="cobranca/lotes-md"
      pk="codlotecob"
      schema={loteCobrancaSchema}
      defaultValues={{ codparceiro: undefined, data: '', itens: [] }}
      colunasPesquisa={[
        { campo: 'codlotecob', label: 'Código' },
        { campo: 'codparceiro', label: 'Parceiro' },
      ]}
      campos={({ form, editavel }) => (
        <div className="flex flex-col gap-form-gap">
          <Field
            label="&Parceiro (cod)"
            type="number"
            disabled={!editavel}
            error={form.formState.errors.codparceiro?.message as string | undefined}
            {...form.register('codparceiro', { valueAsNumber: true })}
          />
          <Field
            label="&Data"
            type="date"
            disabled={!editavel}
            error={form.formState.errors.data?.message as string | undefined}
            {...form.register('data')}
          />
        </div>
      )}
      detalhe={{
        chave: 'itens',
        titulo: 'Itens (contas a receber)',
        novoItem: () => ({ codrcb: undefined }),
        itemCampos: ({ form, editavel, index }) => (
          <Field
            label="Conta a &Receber (cod)"
            type="number"
            disabled={!editavel}
            error={
              (form.formState.errors.itens as any)?.[index]?.codrcb?.message as string | undefined
            }
            {...form.register(`itens.${index}.codrcb` as const, { valueAsNumber: true })}
          />
        ),
      }}
    />
  );
}
