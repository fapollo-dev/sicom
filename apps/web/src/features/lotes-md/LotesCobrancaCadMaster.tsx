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
        { campo: 'codlotecob', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'codparceiro', label: 'Parceiro', tipo: 'text' },
      ]}
      campos={({ form, editavel }) => (
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
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
