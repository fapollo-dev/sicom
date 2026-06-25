import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { tabelaPrecoSchema, type CriarTabelaPrecoDto } from '@apollo/shared';

/**
 * Cadastro de PRECO (Tabela de Reajuste) via o pilar <CadMaster> — texto (Descrição)
 * + PERCENTUAL (Valor do Reajuste, 0–100, sufixo "%", sem spinner) + 2 flags S/N
 * (Reajuste, Ativo) como checkbox. Layout em grid (showcase). Tudo o mais do pilar/engine.
 *
 * Paridade legado (UCadTabelaPreco.pas/.dfm):
 *  - VALOR_REAJUSTE é PERCENTUAL 0–100 (CedValorReajuste: DisplayFormat '0.00',
 *    MaxValue=100, ShowButton=False) — NÃO é moeda.
 *  - OnNewRecord: REAJUSTE='S', ATIVO='S', VALOR_REAJUSTE=0.
 *  - CkbReajusteClick: ao desmarcar Reajuste, o campo de valor é desabilitado E zerado.
 */
export function PrecosCadMaster() {
  return (
    <CadMaster<CriarTabelaPrecoDto>
      titulo="Tabela de Reajuste de Preço"
      resourcePath="cadastro/precos"
      pk="id_preco"
      colunasPesquisa={[
        { campo: 'id_preco', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
        { campo: 'valor_reajuste', label: 'Valor (%)', tipo: 'number', largura: 160 },
      ]}
      schema={tabelaPrecoSchema}
      defaultValues={{ descricao: '', valor_reajuste: undefined, reajuste: 'S', ativo: 'S' }}
      campos={({ form, editavel }) => {
        const reajusteAtivo = form.watch('reajuste') === 'S';
        return (
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
              name="valor_reajuste"
              render={({ field }) => (
                <NumberField
                  label="&Valor do Reajuste (%)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={2}
                  max={100}
                  min={0}
                  endAddon="%"
                  disabled={!editavel || !reajusteAtivo}
                  error={form.formState.errors.valor_reajuste?.message as string | undefined}
                />
              )}
            />
            <div className="flex items-center gap-gp-lg sm:col-span-2">
              <Controller
                control={form.control}
                name="reajuste"
                render={({ field }) => (
                  <CheckboxField
                    label="&Reajuste"
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v);
                      // Legado CkbReajusteClick: ao desmarcar, zera o valor do reajuste.
                      if (v !== 'S') form.setValue('valor_reajuste', 0);
                    }}
                    disabled={!editavel}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="ativo"
                render={({ field }) => (
                  <CheckboxField label="&Ativo" value={field.value} onChange={field.onChange} disabled={!editavel} />
                )}
              />
            </div>
          </div>
        );
      }}
    />
  );
}
