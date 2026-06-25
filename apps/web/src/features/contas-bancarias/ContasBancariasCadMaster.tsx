import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { DateField } from '../../shared/ui/DateField';
import { TextArea } from '../../shared/ui/TextArea';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import {
  contaBancariaSchema,
  TIPO_COBRANCA,
  type CriarContaBancariaDto,
} from '@apollo/shared';

/**
 * Cadastro de Contas Bancárias (legado `UCadContasBancarias`) via o pilar <CadMaster>.
 * Versão COMPLETA e fiel à aba "Contas Correntes" do .dfm. A máquina de estados,
 * código+Enter, Pesquisa (F6), navegação por setas, gravar/excluir com mnemônicos e a
 * camada de teclado vêm do pilar/engine.
 *
 * Palette espelhado do .dfm:
 *  - Banco (FK/LOOKUP → cadastro/bancos), Titular, Nº Conta, Gerente (Field).
 *  - Data de abertura (DateField), Telefone (Field), Observação (TextArea, MAIÚSCULAS).
 *  - Conta Própria / Exibe Rel. Apuração de Caixa / Ativo (CheckboxField S/N).
 *  - Grupo "Boleto": Convênio / Carteira / Variação (NumberField INTEIROS, não moeda),
 *    Tipo do título (SelectField 1–4), Cód. Transmissão (Field).
 *  - Grupo "Arquivo remessa": Nº Convênio (Field).
 *
 * defaultValues espelham OnNewRecord (uRDmCadContaBancaria): ATIVO='S', CONTA_PROPRIA='N'.
 * IDEMPRESA é carimbado no servidor (empresaScoped) — não é campo da tela.
 *
 * DEFERIDO (TODO Fase X): no legado há o LOOKUP de Plano de Contas (CODLANCCONTABIL →
 * GET_PLANO_CONTAS) e a aba mestre-detalhe "Liberação de operadores". Enquanto
 * PLANO_CONTAS/OPERADORES não migram, NÃO renderizamos nenhum dos dois (CODLANCCONTABIL
 * fica como campo texto livre, sem botão de busca; sem aba de operadores).
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
        { campo: 'codconta', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'banco', label: 'Banco', tipo: 'text' },
        { campo: 'titular', label: 'Titular', tipo: 'text' },
        { campo: 'nroconta', label: 'Nº Conta', tipo: 'text', largura: 140 },
        { campo: 'gerente', label: 'Gerente', tipo: 'text' },
        { campo: 'ativo', label: 'Ativo', tipo: 'status', largura: 100 },
      ]}
      schema={contaBancariaSchema}
      defaultValues={{
        codbco: undefined,
        titular: '',
        nroconta: '',
        gerente: '',
        dtabertura: '',
        fone1: '',
        obs: '',
        codlanccontabil: '',
        convenio: undefined,
        carteira_cobranca: undefined,
        variacao_carteira: undefined,
        tipo_cobranca: undefined,
        codigo_transmissao_cobranca: '',
        nroconvenio_arqrem: '',
        conta_propria: 'N', // OnNewRecord / DEFAULT
        exibe_rel_apuracao_caixa: 'N',
        ativo: 'S', // OnNewRecord
      }}
      campos={({ form, editavel }) => (
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          {/* FK/LOOKUP de Banco (CODBCO → BANCOS, obrigatório) */}
          <div className="sm:col-span-2">
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
          </div>

          <Field
            label="&Titular"
            disabled={!editavel}
            error={form.formState.errors.titular?.message as string | undefined}
            {...form.register('titular')}
          />
          <Field
            label="Nº &Conta"
            disabled={!editavel}
            error={form.formState.errors.nroconta?.message as string | undefined}
            {...form.register('nroconta')}
          />

          <Field
            label="&Gerente"
            disabled={!editavel}
            error={form.formState.errors.gerente?.message as string | undefined}
            {...form.register('gerente')}
          />
          <Controller
            control={form.control}
            name="dtabertura"
            render={({ field }) => (
              <DateField
                label="Data de &abertura"
                value={field.value as string | undefined}
                onChange={field.onChange}
                disabled={!editavel}
                error={form.formState.errors.dtabertura?.message as string | undefined}
              />
            )}
          />

          <Field
            label="&Telefone"
            disabled={!editavel}
            error={form.formState.errors.fone1?.message as string | undefined}
            {...form.register('fone1')}
          />
          {/*
            DEFERIDO (TODO Fase X): aqui o legado tem o LOOKUP de Plano de Contas
            (CODLANCCONTABIL → GET_PLANO_CONTAS, com botão de busca e descrição). Enquanto
            PLANO_CONTAS não migrar, fica como campo texto livre, sem lookup.
          */}
          <Field
            label="Plano de contas (cód.)"
            disabled={!editavel}
            error={form.formState.errors.codlanccontabil?.message as string | undefined}
            {...form.register('codlanccontabil')}
          />

          <div className="sm:col-span-2">
            <TextArea
              label="&Observação"
              disabled={!editavel}
              error={form.formState.errors.obs?.message as string | undefined}
              {...form.register('obs')}
            />
          </div>

          {/* Flags S/N */}
          <div className="flex flex-wrap items-center gap-gp-lg sm:col-span-2">
            <Controller
              control={form.control}
              name="conta_propria"
              render={({ field }) => (
                <CheckboxField
                  label="Conta &Interna"
                  value={field.value}
                  onChange={field.onChange}
                  disabled={!editavel}
                />
              )}
            />
            <Controller
              control={form.control}
              name="exibe_rel_apuracao_caixa"
              render={({ field }) => (
                <CheckboxField
                  label="&Exibe no relatório de apuração de caixa"
                  value={field.value}
                  onChange={field.onChange}
                  disabled={!editavel}
                />
              )}
            />
            <Controller
              control={form.control}
              name="ativo"
              render={({ field }) => (
                <CheckboxField
                  label="&Ativo"
                  value={field.value}
                  onChange={field.onChange}
                  disabled={!editavel}
                />
              )}
            />
          </div>

          {/* Grupo "Boleto" (grbBoleto) */}
          <fieldset className="rounded-radius-md border border-border p-pad-md sm:col-span-2">
            <legend className="px-pad-xs text-fg-muted">Boleto</legend>
            <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
              <Controller
                control={form.control}
                name="convenio"
                render={({ field }) => (
                  <NumberField
                    label="&Convênio"
                    value={field.value as number | undefined}
                    onChange={field.onChange}
                    decimais={0}
                    min={0}
                    disabled={!editavel}
                    error={form.formState.errors.convenio?.message as string | undefined}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="tipo_cobranca"
                render={({ field }) => (
                  <SelectField
                    label="&Tipo do título"
                    options={TIPO_COBRANCA}
                    value={field.value ?? undefined}
                    onChange={field.onChange}
                    placeholder="Selecione…"
                    error={form.formState.errors.tipo_cobranca?.message as string | undefined}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="carteira_cobranca"
                render={({ field }) => (
                  <NumberField
                    label="Cart&eira"
                    value={field.value as number | undefined}
                    onChange={field.onChange}
                    decimais={0}
                    min={0}
                    disabled={!editavel}
                    error={form.formState.errors.carteira_cobranca?.message as string | undefined}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="variacao_carteira"
                render={({ field }) => (
                  <NumberField
                    label="&Variação"
                    value={field.value as number | undefined}
                    onChange={field.onChange}
                    decimais={0}
                    min={0}
                    disabled={!editavel}
                    error={form.formState.errors.variacao_carteira?.message as string | undefined}
                  />
                )}
              />
              <div className="sm:col-span-2">
                <Field
                  label="Cód. &Transmissão"
                  disabled={!editavel}
                  error={
                    form.formState.errors.codigo_transmissao_cobranca?.message as string | undefined
                  }
                  {...form.register('codigo_transmissao_cobranca')}
                />
              </div>
            </div>
          </fieldset>

          {/* Grupo "Arquivo remessa" (grbArquivoRemessa) */}
          <fieldset className="rounded-radius-md border border-border p-pad-md sm:col-span-2">
            <legend className="px-pad-xs text-fg-muted">Arquivo remessa</legend>
            <Field
              label="Nº Convênio (arq. &remessa)"
              disabled={!editavel}
              error={form.formState.errors.nroconvenio_arqrem?.message as string | undefined}
              {...form.register('nroconvenio_arqrem')}
            />
          </fieldset>

          {/*
            DEFERIDO (TODO Fase X): aba mestre-detalhe "Liberação de operadores"
            (GrdOperadores sobre OPERADORES) quando a tabela OPERADORES migrar.
          */}
        </div>
      )}
    />
  );
}
