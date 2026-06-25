import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import {
  contaBancariaSchema,
  ATIVO_SN,
  type CriarContaBancariaDto,
} from '@apollo/shared';

/**
 * Cadastro de Contas Bancárias (legado `UCadContasBancarias`) via o pilar <CadMaster>.
 * Espelha o BairrosCadMaster: a tela é só título + recurso + campos; a máquina de
 * estados, código+Enter, Pesquisa (F6), navegação por setas, gravar/excluir com
 * mnemônicos e teclado vêm do pilar/engine.
 *
 * Novidade desta tela: o **LOOKUP/FK de Banco** (CODBCO → BANCOS). As opções vêm de
 * OUTRO recurso (cadastro/bancos) via useResourceOptions e o Controller liga o select
 * ao campo numérico codbco (value=String(codbco), onChange=Number).
 */
export function ContasBancariasCadMaster() {
  // LOOKUP/FK: opções de Banco vêm do recurso cadastro/bancos (outra entidade)
  const { data: bancoOptions = [] } = useResourceOptions('cadastro/bancos', (b: any) => ({
    value: String(b.codbco),
    label: `${b.codbco} - ${b.banco}`,
  }));
  return (
    <CadMaster<CriarContaBancariaDto>
      titulo="Contas Bancárias"
      resourcePath="cadastro/contas-bancarias"
      pk="codconta"
      colunasPesquisa={[
        { campo: 'codconta', label: 'Código' },
        { campo: 'banco', label: 'Banco' },
        { campo: 'titular', label: 'Titular' },
        { campo: 'nroconta', label: 'Nº Conta' },
      ]}
      schema={contaBancariaSchema}
      defaultValues={{ codbco: undefined, titular: '', nroconta: '', ativo: 'S' }}
      campos={({ form }) => (
        <div className="flex flex-col gap-form-gap">
          <Controller
            control={form.control}
            name="codbco"
            render={({ field }) => (
              <SelectField
                label="&Banco"
                options={bancoOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Selecione o banco…"
                error={form.formState.errors.codbco?.message as string | undefined}
              />
            )}
          />
          <Field
            label="&Titular"
            error={form.formState.errors.titular?.message as string | undefined}
            {...form.register('titular')}
          />
          <Field
            label="Nº &Conta"
            error={form.formState.errors.nroconta?.message as string | undefined}
            {...form.register('nroconta')}
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
        </div>
      )}
    />
  );
}
