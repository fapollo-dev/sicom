import { Controller } from 'react-hook-form';
import { CadMasterDet } from '../../shared/cadmaster/CadMasterDet';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { DateField } from '../../shared/ui/DateField';
import { TextArea } from '../../shared/ui/TextArea';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { LookupField } from '../../shared/ui/LookupField';
import { TransferenciasPermitidas } from './TransferenciasPermitidas';
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
 *  - Banco (LookupField → lookup/bancos), Titular, Nº Conta, Gerente (Field).
 *  - Data de abertura (DateField), Telefone (Field), Observação (TextArea, MAIÚSCULAS).
 *  - Conta Própria / Exibe Rel. Apuração de Caixa / Ativo (CheckboxField S/N).
 *  - Grupo "Boleto": Convênio / Carteira / Variação (NumberField INTEIROS, não moeda),
 *    Tipo do título (SelectField 1–4), Cód. Transmissão (Field).
 *  - Grupo "Arquivo remessa": Nº Convênio (Field).
 *
 * defaultValues espelham OnNewRecord (uRDmCadContaBancaria): ATIVO='S', CONTA_PROPRIA='N'.
 * IDEMPRESA é carimbado no servidor (empresaScoped) — não é campo da tela.
 *
 * COMPLETADO (resíduo): as duas partes antes deferidas, agora que PLANO_CONTAS/OPERADORES migraram —
 *  - LOOKUP de Plano de Contas (CODLANCCONTABIL → analíticas; o servidor valida CLASSE='A' e TIPO='E');
 *  - aba mestre-detalhe "Liberação de operadores" (detalhe `operadores`, quem baixa CR/CP por essa conta).
 */
export function ContasBancariasCadMaster() {
  return (
    <CadMasterDet<CriarContaBancariaDto>
      titulo="Contas Bancárias"
      resourcePath="cadastro/contas-bancarias"
      pk="codconta"
      log={{ form: 'FRMCADCONTASBANCARIAS', chave: 'CODCONTA' }}
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'banco', label: 'Banco', tipo: 'text' },
        { campo: 'titular', label: 'Titular', tipo: 'text' },
        { campo: 'nro_conta', label: 'Nº Conta', tipo: 'text', largura: 140 },
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
        operadores: [],
      }}
      detalhe={{
        chave: 'operadores',
        titulo: 'Liberação de operadores (baixa CR/CP por esta conta)',
        novoItem: () => ({ codoperador: undefined as unknown as number, cbo_baixa_cr: 'S', cbo_baixa_cp: 'S' }),
        itemCampos: ({ form, index, editavel }) => (
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
            {/* UCadContasBancarias.pas:165 — GET_OPERADORES, sem filtro */}
            <Controller
              control={form.control}
              name={`operadores.${index}.codoperador` as const}
              render={({ field }) => (
                <LookupField
                  label="Operador"
                  recurso="lookup/operadores"
                  campoCodigo="codoperador"
                  descricao="nome"
                  value={field.value as number | undefined}
                  onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)}
                  disabled={!editavel}
                />
              )}
            />
            <Controller
              control={form.control}
              name={`operadores.${index}.cbo_baixa_cr` as const}
              render={({ field }) => <CheckboxField label="Baixa a &receber" value={field.value ?? 'S'} onChange={field.onChange} />}
            />
            <Controller
              control={form.control}
              name={`operadores.${index}.cbo_baixa_cp` as const}
              render={({ field }) => <CheckboxField label="Baixa a &pagar" value={field.value ?? 'S'} onChange={field.onChange} />}
            />
          </div>
        ),
      }}
      campos={({ form, editavel }) => (
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          {/* FK/LOOKUP de Banco (CODBCO → BANCOS, obrigatório) — UCadContasBancarias.pas:131/147, GET_BANCOS sem filtro */}
          <div className="sm:col-span-2">
            <Controller
              control={form.control}
              name="codbco"
              render={({ field }) => (
                <LookupField
                  label="Banco"
                  recurso="lookup/bancos"
                  campoCodigo="codigo"
                  descricao="banco"
                  value={field.value as number | undefined}
                  onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)}
                  error={form.formState.errors.codbco?.message as string | undefined}
                  disabled={!editavel}
                />
              )}
            />
          </div>

          <Field
            label="Titular"
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
            label="Gerente"
            disabled={!editavel}
            error={form.formState.errors.gerente?.message as string | undefined}
            {...form.register('gerente')}
          />
          <Controller
            control={form.control}
            name="dtabertura"
            render={({ field }) => (
              <DateField
                label="Data de abertura"
                value={field.value as string | undefined}
                onChange={field.onChange}
                disabled={!editavel}
                error={form.formState.errors.dtabertura?.message as string | undefined}
              />
            )}
          />

          <Field
            label="Telefone"
            disabled={!editavel}
            error={form.formState.errors.fone1?.message as string | undefined}
            {...form.register('fone1')}
          />
          {/* LOOKUP Plano de Contas (CODLANCCONTABIL) — UCadContasBancarias.pas:175, GET_PLANO_CONTAS (CLASSE='ANALITICA') AND
              (TIPO='EMPRESA') — o texto da view do legado (classe 'A' e tipo 'E' na tabela); o servidor confere o mesmo no gravar */}
          <Controller
            control={form.control}
            name="codlanccontabil"
            render={({ field }) => (
              <LookupField
                label="Plano de contas"
                recurso="lookup/plano-contas" campoDigitado="codireduzido"
                campoCodigo="codplanocontas"
                descricao="descricao"
                fixos={{ classe: 'ANALITICA', tipo: 'EMPRESA' }}
                value={field.value != null && field.value !== '' ? String(field.value) : undefined}
                onChange={(cod) => field.onChange(cod ?? '')}
                error={form.formState.errors.codlanccontabil?.message as string | undefined}
                disabled={!editavel}
              />
            )}
          />

          <div className="sm:col-span-2">
            <TextArea
              label="Observação"
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
                  label="Conta Interna"
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
                  label="Exibe no relatório de apuração de caixa"
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
                  label="Ativo"
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
                    label="Convênio"
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
                    label="Tipo do título"
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
                    label="Carteira"
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
                    label="Variação"
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
                  label="Cód. Transmissão"
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

          {/* Transferências permitidas (CONTAS_BANC_TRANSF_PERM, mig 295) — recurso da conta, fora do agregado */}
          <fieldset className="rounded-radius-md border border-border p-pad-md sm:col-span-2">
            <legend className="px-pad-xs text-fg-muted">Transferências permitidas</legend>
            <TransferenciasPermitidas
              codconta={(() => { const v = form.watch('codconta' as any) ?? (form.getValues() as Record<string, unknown>).codconta; return v == null ? null : Number(v); })()}
              editavel={editavel}
            />
          </fieldset>

        </div>
      )}
    />
  );
}
