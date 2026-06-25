import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { bancoSchema, type CriarBancoDto } from '@apollo/shared';

/**
 * Cadastro de Bancos via o pilar <CadMaster> — herdeira fiel do legado `frmCadBancos`
 * (dossiê retaguarda/uCadBancos). A tela é só título + recurso + campos; todo o resto
 * (máquina de estados browse/insert/edit, código+Enter, Pesquisa, navegação por setas,
 * gravar/editar/excluir com mnemônicos, carimbo) vem do pilar/engine.
 *
 * Mapeamento legado → schema (banco.schema):
 *  - BANCO (obrigatório, BR-02) → banco
 *  - CIDADE (obrigatório, BR-02) → cidade
 *  - AGENCIA (texto, BR-04 uppercase) → agencia
 *  - AGENCIA_CEDENTE (inteiro) → agenciaCedente
 *  - CODBCOBLT — "Cód. Banco (boletos)" (inteiro) → codbcoblt
 *  - CONVENIO (inteiro) → convenio
 *  - CARTEIRA_COBRANCA (inteiro) → carteiraCobranca
 *  - VARIACAO_CARTEIRA (inteiro) → variacaoCarteira
 * UF existe no schema mas a tela legada não a expõe (gap §2 do dossiê) → omitida (paridade).
 *
 * PK CODBCO é gerada por sequence (app-side) → pkGerada default (true); a view get_bancos
 * expõe a PK como `codigo` → viewPk="codigo".
 */
export function BancosCadMaster() {
  return (
    <CadMaster<CriarBancoDto>
      titulo="Bancos"
      resourcePath="cadastro/bancos"
      pk="codbco"
      viewPk="codigo" // get_bancos expõe a PK como 'codigo'
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'banco', label: 'Banco', tipo: 'text' },
        { campo: 'agencia', label: 'Agência', tipo: 'text', largura: 140 },
        { campo: 'cidade', label: 'Cidade', tipo: 'text' },
      ]}
      schema={bancoSchema}
      defaultValues={{
        banco: '',
        cidade: '',
        agencia: undefined,
        agenciaCedente: undefined,
        codbcoblt: undefined,
        convenio: undefined,
        carteiraCobranca: undefined,
        variacaoCarteira: undefined,
      }}
      campos={({ form, editavel }) => (
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="&Banco"
              disabled={!editavel}
              error={form.formState.errors.banco?.message as string | undefined}
              {...form.register('banco')}
            />
          </div>
          <Field
            label="&Cidade"
            disabled={!editavel}
            error={form.formState.errors.cidade?.message as string | undefined}
            {...form.register('cidade')}
          />
          <Field
            label="&Agência"
            disabled={!editavel}
            error={form.formState.errors.agencia?.message as string | undefined}
            {...form.register('agencia')}
          />
          <Controller
            control={form.control}
            name="agenciaCedente"
            render={({ field }) => (
              <NumberField
                label="Agência Ce&dente"
                decimais={0}
                disabled={!editavel}
                value={field.value ?? undefined}
                onChange={field.onChange}
                error={form.formState.errors.agenciaCedente?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="codbcoblt"
            render={({ field }) => (
              <NumberField
                label="Cód. Banco (&boletos)"
                decimais={0}
                disabled={!editavel}
                value={field.value ?? undefined}
                onChange={field.onChange}
                error={form.formState.errors.codbcoblt?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="convenio"
            render={({ field }) => (
              <NumberField
                label="Con&vênio"
                decimais={0}
                disabled={!editavel}
                value={field.value ?? undefined}
                onChange={field.onChange}
                error={form.formState.errors.convenio?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="carteiraCobranca"
            render={({ field }) => (
              <NumberField
                label="Carteira Cob&rança"
                decimais={0}
                disabled={!editavel}
                value={field.value ?? undefined}
                onChange={field.onChange}
                error={form.formState.errors.carteiraCobranca?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="variacaoCarteira"
            render={({ field }) => (
              <NumberField
                label="Variação Car&teira"
                decimais={0}
                disabled={!editavel}
                value={field.value ?? undefined}
                onChange={field.onChange}
                error={form.formState.errors.variacaoCarteira?.message as string | undefined}
              />
            )}
          />
        </div>
      )}
    />
  );
}
