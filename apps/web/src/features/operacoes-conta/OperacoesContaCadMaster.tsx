import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import {
  operacaoContaSchema,
  TIPO_OPERACAO_CONTA,
  type CriarOperacaoContaDto,
} from '@apollo/shared';

/**
 * Cadastro de Operações de Conta — herdeira do pilar <CadMaster> (record-first).
 * A tela é só título + recurso + campos: <Field> (DESCRICAO) + <SelectField> (TIPO,
 * lista fixa C/D). Tudo o mais (máquina de estados, código+Enter, Pesquisa F6,
 * navegação por setas, gravar/excluir com mnemônicos, carimbo, histórico) vem do pilar.
 *
 * Divergências fiéis ao dossiê (uCadOperacoesConta) vs. o piloto Bancos:
 *  - DESCRICAO **sem uppercase** (o .dfm não tem CharCase) — gravada como digitada.
 *  - BR-05: default TIPO='D' ao inserir (OnNewRecord do datamodule legado) →
 *    defaultValues={{ descricao: '', tipo: 'D' }} fecha o gap de paridade da inclusão.
 */
export function OperacoesContaCadMaster() {
  return (
    <CadMaster<CriarOperacaoContaDto>
      titulo="Operações da conta"
      resourcePath="cadastro/operacoes-conta"
      pk="codopconta"
      colunasPesquisa={[
        { campo: 'codopconta', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
        { campo: 'tipo', label: 'Tipo', tipo: 'text', largura: 130 },
      ]}
      schema={operacaoContaSchema}
      defaultValues={{ descricao: '', tipo: 'D' }}
      campos={({ form, editavel }) => (
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
            name="tipo"
            render={({ field }) => (
              <SelectField
                label="&Tipo"
                options={TIPO_OPERACAO_CONTA}
                value={field.value ?? 'D'}
                onChange={field.onChange}
                placeholder="Selecione o tipo…"
                error={form.formState.errors.tipo?.message as string | undefined}
              />
            )}
          />
        </div>
      )}
    />
  );
}
