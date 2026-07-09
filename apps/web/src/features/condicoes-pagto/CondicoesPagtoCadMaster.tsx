import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { condicoesPagtoSchema, type CriarCondicaoPagtoDto } from '@apollo/shared';

/**
 * Cadastro de CONDIÇÕES DE PAGAMENTO (CONDICOES_PAGTO) — lookup GLOBAL do Pedido de Compra (corte-2).
 * Define os prazos (dias) de cada parcela em CD1..CD8; o nº de parcelas de um pedido = qtd de CDn
 * preenchidos. Molde <CadMaster> (marcas/motivos). CD1 obrigatório (uma condição sem prazo não gera nada).
 */
const CDS = ['cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'] as const;

export function CondicoesPagtoCadMaster() {
  return (
    <CadMaster<CriarCondicaoPagtoDto>
      titulo="Condições de Pagamento"
      resourcePath="compras/condicoes-pagto"
      pk="codconpagto"
      viewPk="codigo"
      colunasPesquisa={[
        { campo: 'codconpagto', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
        { campo: 'cd1', label: '1º prazo', tipo: 'text', largura: 100 },
        { campo: 'cd2', label: '2º prazo', tipo: 'text', largura: 100 },
        { campo: 'cd3', label: '3º prazo', tipo: 'text', largura: 100 },
      ]}
      schema={condicoesPagtoSchema}
      defaultValues={{ descricao: '', cd1: undefined }}
      campos={({ form, editavel }) => (
        <div className="flex flex-col gap-form-gap">
          <Field
            label="&Descrição"
            maxLength={100}
            disabled={!editavel}
            error={form.formState.errors.descricao?.message as string | undefined}
            {...form.register('descricao')}
          />
          <fieldset disabled={!editavel} className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Prazos das parcelas (dias)</legend>
            <p className="mb-form-gap text-body-sm text-fg-muted">
              Cada prazo preenchido gera uma parcela (venc. = data do pedido + dias). Deixe em branco para não usar.
            </p>
            <div className="grid grid-cols-2 gap-form-gap sm:grid-cols-4">
              {CDS.map((cd, i) => (
                <Controller
                  key={cd}
                  control={form.control}
                  name={cd}
                  render={({ field }) => (
                    <NumberField
                      label={`${i + 1}ª parcela (dias)${i === 0 ? ' *' : ''}`}
                      value={field.value as number | undefined}
                      onChange={(v) => field.onChange(v)}
                      decimais={0}
                      min={0}
                      error={form.formState.errors[cd]?.message as string | undefined}
                    />
                  )}
                />
              ))}
            </div>
          </fieldset>
        </div>
      )}
    />
  );
}
