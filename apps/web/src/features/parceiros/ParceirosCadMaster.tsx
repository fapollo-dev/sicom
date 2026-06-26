import { useMemo, useState } from 'react';
import { Controller, useFieldArray, type UseFormReturn } from 'react-hook-form';
import { Pencil, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumnDef } from '@apollosg/design-system';
import {
  parceiroSchema,
  PAPEIS_PARCEIRO,
  TIPOFJ_OPCOES,
  CONTRIBUINTE_ICMS_OPCOES,
  CLASSFISCAL_OPCOES,
  IRRF_OPCOES,
  APURACAO_OPCOES,
  CLASSIFICACAO_OPCOES,
  RETENCOES_PARCEIRO,
  type CriarParceiroDto,
  type EnderecoParceiroDto,
} from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { DateField } from '../../shared/ui/DateField';
import { TextArea } from '../../shared/ui/TextArea';
import { Button } from '../../shared/ui/Button';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { EnderecoModal, type TipoFj } from './EnderecoModal';
import {
  BancosSection,
  PgtosSection,
  RelacionamentosSection,
  VendedoresSection,
} from './ParceirosDetalhes';

/**
 * Papel da tela (parametrização). A MESMA tela serve Cliente/Fornecedor/etc. — só muda
 * o título, a flag pré-marcada no novo registro e o filtro da Pesquisa. (Extensível:
 * basta acrescentar entradas em PAPEL_FLAG / PAPEL_TITULO.)
 */
export type Papel = 'cliente' | 'fornecedor';

/** papel → flag do master (CLI/FRN…), espelhando PAPEIS_PARCEIRO. */
const PAPEL_FLAG: Record<Papel, 'cli' | 'frn'> = {
  cliente: 'cli',
  fornecedor: 'frn',
};
const PAPEL_TITULO: Record<Papel, string> = {
  cliente: 'Clientes',
  fornecedor: 'Fornecedores',
};

/**
 * Cadastro UNIFICADO de PARCEIROS (legado `TfrmCadClientes` — uma só tela p/ Cliente/
 * Fornecedor/Funcionário/Transportador/Convênio), construído sobre o pilar <CadMaster>
 * + o engine agregado (master PARCEIROS + detalhe 1:N PARCEIROS_END numa só gravação).
 *
 * Parametrizada por `papel`: /cadastro/clientes e /cadastro/fornecedores são ESTE mesmo
 * componente com props diferentes. O papel:
 *  - vira o TÍTULO ("Clientes"/"Fornecedores");
 *  - pré-marca a flag correspondente (cli/frn) no novo registro (defaultValues);
 *  - filtra a Pesquisa (campo=<flag>&operador=igual&valor=S) — "Clientes" lista só CLI='S".
 *
 * Erros de negócio do back (ex.: "ao menos um papel" → 400; CNPJ duplicado → 409
 * DUPLICADO) sobem como envelope PT e são exibidos pelo <CadMaster> via useMensagem.
 */
export function ParceirosCadMaster({ papel }: { papel: Papel }) {
  const flag = PAPEL_FLAG[papel];
  const titulo = PAPEL_TITULO[papel];

  // LOOKUPs do master — vendedor (FUN='S') e convênio (CON='S'), via o recurso de
  // parceiros filtrado por flag. Mostra "cod - razão" (não o id cru).
  const { data: vendedorOptions = [] } = useResourceOptions(
    'cadastro/parceiros',
    (p: any) => ({ value: String(p.codparceiro), label: `${p.codparceiro} - ${p.razao}` }),
    { campo: 'fun', operador: 'igual', valor: 'S' }, // vendedor = parceiro FUN='S'
  );
  const { data: convenioOptions = [] } = useResourceOptions(
    'cadastro/parceiros',
    (p: any) => ({ value: String(p.codparceiro), label: `${p.codparceiro} - ${p.razao}` }),
    { campo: 'con', operador: 'igual', valor: 'S' }, // convênio = parceiro CON='S'
  );
  // F3 — entidade recolhedora de ISSQN: parceiro com TIPOFJ='E' (entidade). Mostra "cod - razão".
  const { data: entidadeIssqnOptions = [] } = useResourceOptions(
    'cadastro/parceiros',
    (p: any) => ({ value: String(p.codparceiro), label: `${p.codparceiro} - ${p.razao}` }),
    { campo: 'tipofj', operador: 'igual', valor: 'E' }, // entidades (TIPOFJ='E')
  );

  // OnNewRecord do legado: ATIVADO='S', BLOQUED='N', tipofj='F', e a flag do papel já
  // marcada (cli/frn = 'S'). Os demais papéis começam 'N'.
  const defaultValues = useMemo<Partial<CriarParceiroDto>>(
    () => ({
      razao: '',
      fantasia: '',
      tipofj: 'F',
      cli: 'N',
      frn: 'N',
      fun: 'N',
      tra: 'N',
      con: 'N',
      ass: 'N',
      [flag]: 'S', // papel da tela já vem marcado
      ativado: 'S',
      bloqued: 'N',
      email: '',
      dtnascimento: '',
      obs: '',
      credito: undefined,
      txjuro: undefined,
      tolerancia: undefined,
      descpadrao: undefined,
      diasprazo: undefined,
      codvendedor: undefined,
      codconvenio: undefined,
      // F2 — campos condicionais por papel (Fornecedor/Cliente/Funcionário) + fiscal
      venc_prev: undefined,
      dtultcompra: '',
      classfornecedor: undefined,
      codref: undefined,
      codcontabil_for: undefined,
      limite_especial: undefined,
      codcontabil: undefined,
      renda: undefined,
      cargo: undefined,
      empresatrabalha: undefined,
      // F3 — fiscal (configuração; a tela armazena). estrangeiro bloqueia o autofill de CEP.
      estrangeiro: 'N',
      // combos fiscais começam vazios (undefined) — contribuinte_icms é código Sintegra (1/2/9),
      // NÃO uma flag S/N (correção F3: era CheckboxField, virou SelectField).
      contribuinte_icms: undefined,
      classfiscal: undefined,
      irrf: undefined,
      apuracao: undefined,
      classificacao: undefined,
      envianfe: 'N',
      devolucao_zera_imposto_icmsst: 'N',
      // 7 flags de retenção de ENTRADA (NF) — começam 'N'
      habilita_retencao_pis_nf: 'N',
      habilita_retencao_cofins_nf: 'N',
      habilita_retencao_csll_nf: 'N',
      habilita_retencao_ir_nf: 'N',
      habilita_retencao_inss_nf: 'N',
      habilita_retencao_issqn_nf: 'N',
      habilita_retencao_funrural_nf: 'N',
      perc_aliquota_ir: undefined,
      perc_aliquota_issqn: undefined,
      codparceiro_ent_issqn: undefined,
      // F2 — detalhes 1:N (engine grava todos numa transação)
      enderecos: [],
      bancos: [],
      pgtos: [],
      relacionamentos: [],
      vendedores: [],
    }),
    [flag],
  );

  return (
    <CadMaster<CriarParceiroDto>
      titulo={titulo}
      resourcePath="cadastro/parceiros"
      pk="codparceiro"
      schema={parceiroSchema}
      defaultValues={defaultValues}
      // a Pesquisa lista só o papel da tela (CLI='S' p/ Clientes, FRN='S' p/ Fornecedores)
      filtroPesquisa={{ campo: flag, operador: 'igual', valor: 'S' }}
      colunasPesquisa={[
        { campo: 'codparceiro', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'razao', label: 'Razão / Nome', tipo: 'text' },
        { campo: 'fantasia', label: 'Fantasia', tipo: 'text' },
        { campo: 'cnpj_cpf', label: 'CNPJ/CPF', tipo: 'text', largura: 170 },
        { campo: 'cidade', label: 'Cidade', tipo: 'text' },
        { campo: 'ativado', label: 'Ativo', tipo: 'status', largura: 100 },
      ]}
      campos={({ form, editavel }) => (
        <div className="flex flex-col gap-form-gap">
          {/* ===== Seção: Cadastro ===== */}
          <fieldset className="rounded-radius-md border border-border p-pad-md">
            <legend className="px-pad-xs text-fg-muted">Cadastro</legend>
            <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field
                  label="&Razão social / Nome"
                  disabled={!editavel}
                  error={form.formState.errors.razao?.message as string | undefined}
                  {...form.register('razao')}
                />
              </div>
              <Field
                label="&Fantasia"
                disabled={!editavel}
                error={form.formState.errors.fantasia?.message as string | undefined}
                {...form.register('fantasia')}
              />
              <Controller
                control={form.control}
                name="tipofj"
                render={({ field }) => (
                  <SelectField
                    label="&Tipo de pessoa"
                    options={TIPOFJ_OPCOES}
                    value={field.value ?? undefined}
                    onChange={field.onChange}
                    placeholder="Selecione…"
                    error={form.formState.errors.tipofj?.message as string | undefined}
                  />
                )}
              />
              <Field
                label="&E-mail"
                disabled={!editavel}
                error={form.formState.errors.email?.message as string | undefined}
                {...form.register('email')}
              />
              <Controller
                control={form.control}
                name="dtnascimento"
                render={({ field }) => (
                  <DateField
                    label="&Nascimento / Fundação"
                    value={field.value as string | undefined}
                    onChange={(v) => field.onChange(v ?? '')}
                    disabled={!editavel}
                    error={form.formState.errors.dtnascimento?.message as string | undefined}
                  />
                )}
              />

              {/* Tipo(s) do parceiro — um checkbox por papel (cli/frn/fun/tra/con) */}
              <fieldset className="rounded-radius-base border border-border p-pad-md sm:col-span-2">
                <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">
                  Tipo(s) do parceiro
                </legend>
                <div className="flex flex-wrap items-center gap-gp-lg">
                  {PAPEIS_PARCEIRO.map((p) => (
                    <Controller
                      key={p.campo}
                      control={form.control}
                      name={p.campo as keyof CriarParceiroDto as any}
                      render={({ field }) => (
                        <CheckboxField
                          label={p.label}
                          value={field.value as string | undefined}
                          onChange={field.onChange}
                          disabled={!editavel}
                        />
                      )}
                    />
                  ))}
                </div>
                {/* a regra "ao menos um papel" do schema reporta em `cli` */}
                {form.formState.errors.cli?.message && (
                  <small className="mt-gp-xs block text-fg-danger">
                    {form.formState.errors.cli.message as string}
                  </small>
                )}
              </fieldset>

              <div className="flex flex-wrap items-center gap-gp-lg sm:col-span-2">
                <Controller
                  control={form.control}
                  name="ativado"
                  render={({ field }) => (
                    <CheckboxField
                      label="&Ativado"
                      value={field.value}
                      onChange={field.onChange}
                      disabled={!editavel}
                    />
                  )}
                />
                <Controller
                  control={form.control}
                  name="bloqued"
                  render={({ field }) => (
                    <CheckboxField
                      label="&Bloqueado"
                      value={field.value}
                      onChange={field.onChange}
                      disabled={!editavel}
                    />
                  )}
                />
                {/* F3 — parceiro estrangeiro: bloqueia consulta de CEP aos Correios no endereço. */}
                <Controller
                  control={form.control}
                  name="estrangeiro"
                  render={({ field }) => (
                    <CheckboxField
                      label="E&strangeiro"
                      value={field.value}
                      onChange={field.onChange}
                      disabled={!editavel}
                    />
                  )}
                />
              </div>
            </div>
          </fieldset>

          {/* ===== Seção: Financeiro ===== */}
          <fieldset className="rounded-radius-md border border-border p-pad-md">
            <legend className="px-pad-xs text-fg-muted">Financeiro</legend>
            <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
              <Controller
                control={form.control}
                name="credito"
                render={({ field }) => (
                  <CurrencyField
                    label="&Crédito"
                    value={field.value as number | undefined}
                    onChange={field.onChange}
                    disabled={!editavel}
                    error={form.formState.errors.credito?.message as string | undefined}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="txjuro"
                render={({ field }) => (
                  <NumberField
                    label="Ta&xa de juros (%)"
                    value={field.value as number | undefined}
                    onChange={field.onChange}
                    decimais={2}
                    min={0}
                    endAddon="%"
                    disabled={!editavel}
                    error={form.formState.errors.txjuro?.message as string | undefined}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="descpadrao"
                render={({ field }) => (
                  <NumberField
                    label="&Desconto padrão (%)"
                    value={field.value as number | undefined}
                    onChange={field.onChange}
                    decimais={2}
                    min={0}
                    endAddon="%"
                    disabled={!editavel}
                    error={form.formState.errors.descpadrao?.message as string | undefined}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="tolerancia"
                render={({ field }) => (
                  <NumberField
                    label="To&lerância (dias)"
                    value={field.value as number | undefined}
                    onChange={field.onChange}
                    decimais={0}
                    min={0}
                    disabled={!editavel}
                    error={form.formState.errors.tolerancia?.message as string | undefined}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="diasprazo"
                render={({ field }) => (
                  <NumberField
                    label="Dias de pra&zo"
                    value={field.value as number | undefined}
                    onChange={field.onChange}
                    decimais={0}
                    min={0}
                    disabled={!editavel}
                    error={form.formState.errors.diasprazo?.message as string | undefined}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="codvendedor"
                render={({ field }) => (
                  <SelectField
                    label="&Vendedor"
                    options={vendedorOptions}
                    value={field.value != null ? String(field.value) : undefined}
                    onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                    placeholder="Selecione o vendedor…"
                    error={form.formState.errors.codvendedor?.message as string | undefined}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="codconvenio"
                render={({ field }) => (
                  <SelectField
                    label="C&onvênio"
                    options={convenioOptions}
                    value={field.value != null ? String(field.value) : undefined}
                    onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                    placeholder="Selecione o convênio…"
                    error={form.formState.errors.codconvenio?.message as string | undefined}
                  />
                )}
              />
            </div>
          </fieldset>

          {/* ===== Seção: Observação ===== */}
          <TextArea
            label="O&bservação"
            disabled={!editavel}
            error={form.formState.errors.obs?.message as string | undefined}
            {...form.register('obs')}
          />

          {/* ===== Seções condicionais por papel (F2) — só aparecem com a flag marcada ===== */}
          <CamposCondicionais form={form} editavel={editavel} />

          {/* ===== Seção: Fiscal (sempre) ===== */}
          <FiscalSection
            form={form}
            editavel={editavel}
            entidadeIssqnOptions={entidadeIssqnOptions}
          />

          {/* ===== Seção: Endereços (detalhe 1:N) ===== */}
          <EnderecosSection form={form} editavel={editavel} />

          {/* ===== Detalhes 1:N adicionais (F2) ===== */}
          <BancosSection form={form} editavel={editavel} />
          <PgtosSection form={form} editavel={editavel} />
          <RelacionamentosSection form={form} editavel={editavel} />
          <VendedoresSection form={form} editavel={editavel} />
        </div>
      )}
    />
  );
}

/**
 * Campos CONDICIONAIS por papel (F2). As seções aparecem/somem conforme as flags do
 * master (frn/cli/fun), observadas via `form.watch`. Os campos vivem no master (mesmo
 * objeto do `parceiroSchema`); a visibilidade é puramente de UI — o legado só preenche
 * esses dados quando o parceiro tem o papel correspondente.
 */
function CamposCondicionais({
  form,
  editavel,
}: {
  form: UseFormReturn<CriarParceiroDto>;
  editavel: boolean;
}) {
  // observa as 3 flags que governam as seções condicionais
  const ehFornecedor = form.watch('frn') === 'S';
  const ehCliente = form.watch('cli') === 'S';
  const ehFuncionario = form.watch('fun') === 'S';

  return (
    <>
      {/* ===== Fornecedor (frn === 'S') ===== */}
      {ehFornecedor && (
        <fieldset className="rounded-radius-md border border-border p-pad-md">
          <legend className="px-pad-xs text-fg-muted">Fornecedor</legend>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <Controller
              control={form.control}
              name="venc_prev"
              render={({ field }) => (
                <NumberField
                  label="&Vencimento previsto (dias)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={0}
                  min={0}
                  disabled={!editavel}
                  error={form.formState.errors.venc_prev?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="dtultcompra"
              render={({ field }) => (
                <DateField
                  label="&Última compra"
                  value={field.value as string | undefined}
                  onChange={(v) => field.onChange(v ?? '')}
                  disabled={!editavel}
                  error={form.formState.errors.dtultcompra?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="classfornecedor"
              render={({ field }) => (
                <NumberField
                  label="&Classificação"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={0}
                  min={0}
                  disabled={!editavel}
                  error={form.formState.errors.classfornecedor?.message as string | undefined}
                />
              )}
            />
            <Field
              label="Cód. &referência"
              disabled={!editavel}
              error={form.formState.errors.codref?.message as string | undefined}
              {...form.register('codref')}
            />
            <Field
              label="Cód. con&tábil (forn.)"
              disabled={!editavel}
              error={form.formState.errors.codcontabil_for?.message as string | undefined}
              {...form.register('codcontabil_for')}
            />
          </div>
        </fieldset>
      )}

      {/* ===== Cliente (cli === 'S') ===== */}
      {ehCliente && (
        <fieldset className="rounded-radius-md border border-border p-pad-md">
          <legend className="px-pad-xs text-fg-muted">Cliente</legend>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <Controller
              control={form.control}
              name="limite_especial"
              render={({ field }) => (
                <CurrencyField
                  label="&Limite especial"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  disabled={!editavel}
                  error={form.formState.errors.limite_especial?.message as string | undefined}
                />
              )}
            />
            <Field
              label="Cód. con&tábil"
              disabled={!editavel}
              error={form.formState.errors.codcontabil?.message as string | undefined}
              {...form.register('codcontabil')}
            />
          </div>
        </fieldset>
      )}

      {/* ===== Funcionário (fun === 'S') ===== */}
      {ehFuncionario && (
        <fieldset className="rounded-radius-md border border-border p-pad-md">
          <legend className="px-pad-xs text-fg-muted">Funcionário</legend>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <Controller
              control={form.control}
              name="renda"
              render={({ field }) => (
                <CurrencyField
                  label="&Renda"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  disabled={!editavel}
                  error={form.formState.errors.renda?.message as string | undefined}
                />
              )}
            />
            <Field
              label="&Cargo"
              disabled={!editavel}
              error={form.formState.errors.cargo?.message as string | undefined}
              {...form.register('cargo')}
            />
            <Field
              label="&Empresa onde trabalha"
              disabled={!editavel}
              error={form.formState.errors.empresatrabalha?.message as string | undefined}
              {...form.register('empresatrabalha')}
            />
          </div>
        </fieldset>
      )}
    </>
  );
}

/**
 * Fiscal (sempre visível). PAINEL de configuração fiscal do parceiro — a tela ARMAZENA;
 * o cálculo vive a jusante (NF/financeiro). Todos os combos vêm de constantes do schema
 * (@apollo/shared), zero hardcode.
 *
 * Correções F3 (vs. F2):
 *  - `contribuinte_icms` NÃO é S/N — é código Sintegra (1/2/9) → SelectField
 *    (CONTRIBUINTE_ICMS_OPCOES). Antes estava (errado) como CheckboxField.
 *  - `classfiscal` é regime tributário (ME/LR/SN/LP) → SelectField (CLASSFISCAL_OPCOES),
 *    não Field de 2 chars.
 *
 * Sub-painel "Retenções (NF de entrada)": as 7 flags S/N (RETENCOES_PARCEIRO) + as alíquotas
 * IR (2 casas) e ISSQN (4 casas). PARIDADE: as alíquotas são SEMPRE editáveis — o legado não
 * as desabilita/zera conforme as flags; amarrá-las seria regra inventada.
 *
 * Entidade ISSQN: lookup de parceiro TIPOFJ='E' (codparceiro_ent_issqn).
 */
function FiscalSection({
  form,
  editavel,
  entidadeIssqnOptions,
}: {
  form: UseFormReturn<CriarParceiroDto>;
  editavel: boolean;
  entidadeIssqnOptions: { value: string; label: string }[];
}) {
  return (
    <fieldset className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Fiscal</legend>
      <div className="flex flex-col gap-form-gap">
        {/* Combos fiscais do master */}
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <Controller
            control={form.control}
            name="contribuinte_icms"
            render={({ field }) => (
              <SelectField
                label="Contri&buinte de ICMS"
                options={CONTRIBUINTE_ICMS_OPCOES}
                value={field.value ?? undefined}
                onChange={field.onChange}
                placeholder="Selecione…"
                error={form.formState.errors.contribuinte_icms?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="classfiscal"
            render={({ field }) => (
              <SelectField
                label="Class. &fiscal"
                options={CLASSFISCAL_OPCOES}
                value={field.value ?? undefined}
                onChange={field.onChange}
                placeholder="Selecione…"
                error={form.formState.errors.classfiscal?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="irrf"
            render={({ field }) => (
              <SelectField
                label="&IRRF"
                options={IRRF_OPCOES}
                value={field.value ?? undefined}
                onChange={field.onChange}
                placeholder="Selecione…"
                error={form.formState.errors.irrf?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="apuracao"
            render={({ field }) => (
              <SelectField
                label="A&puração"
                options={APURACAO_OPCOES}
                value={field.value ?? undefined}
                onChange={field.onChange}
                placeholder="Selecione…"
                error={form.formState.errors.apuracao?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="classificacao"
            render={({ field }) => (
              <SelectField
                label="Classi&ficação"
                options={CLASSIFICACAO_OPCOES}
                value={field.value ?? undefined}
                onChange={field.onChange}
                placeholder="Selecione…"
                error={form.formState.errors.classificacao?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="codparceiro_ent_issqn"
            render={({ field }) => (
              <SelectField
                label="Entidade I&SSQN"
                options={entidadeIssqnOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Selecione a entidade…"
                error={form.formState.errors.codparceiro_ent_issqn?.message as string | undefined}
              />
            )}
          />
        </div>

        {/* Flags fiscais (S/N) */}
        <div className="flex flex-wrap items-center gap-gp-lg">
          <Controller
            control={form.control}
            name="envianfe"
            render={({ field }) => (
              <CheckboxField
                label="Envia &NF-e"
                value={field.value as string | undefined}
                onChange={field.onChange}
                disabled={!editavel}
              />
            )}
          />
          <Controller
            control={form.control}
            name="devolucao_zera_imposto_icmsst"
            render={({ field }) => (
              <CheckboxField
                label="Devolução &zera imposto ICMS-ST"
                value={field.value as string | undefined}
                onChange={field.onChange}
                disabled={!editavel}
              />
            )}
          />
        </div>

        {/* Sub-painel: Retenções (NF de entrada) */}
        <fieldset className="rounded-radius-base border border-border p-pad-md">
          <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">
            Retenções (NF de entrada)
          </legend>
          <div className="flex flex-col gap-form-gap">
            <div className="flex flex-wrap items-center gap-gp-lg">
              {RETENCOES_PARCEIRO.map((r) => (
                <Controller
                  key={r.campo}
                  control={form.control}
                  name={r.campo as keyof CriarParceiroDto as any}
                  render={({ field }) => (
                    <CheckboxField
                      label={r.label}
                      value={field.value as string | undefined}
                      onChange={field.onChange}
                      disabled={!editavel}
                    />
                  )}
                />
              ))}
            </div>
            {/* Alíquotas SEMPRE editáveis (paridade: não atreladas às flags acima). */}
            <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
              <Controller
                control={form.control}
                name="perc_aliquota_ir"
                render={({ field }) => (
                  <NumberField
                    label="Alíquota I&R (%)"
                    value={field.value as number | undefined}
                    onChange={field.onChange}
                    decimais={2}
                    min={0}
                    endAddon="%"
                    disabled={!editavel}
                    error={form.formState.errors.perc_aliquota_ir?.message as string | undefined}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="perc_aliquota_issqn"
                render={({ field }) => (
                  <NumberField
                    label="Alíquota ISS&QN (%)"
                    value={field.value as number | undefined}
                    onChange={field.onChange}
                    decimais={4}
                    min={0}
                    endAddon="%"
                    disabled={!editavel}
                    error={form.formState.errors.perc_aliquota_issqn?.message as string | undefined}
                  />
                )}
              />
            </div>
          </div>
        </fieldset>
      </div>
    </fieldset>
  );
}

/**
 * Detalhe 1:N (PARCEIROS_END) — GRID dos endereços + botões adicionar/editar/remover
 * via `useFieldArray('enderecos')`. Endereços recém-adicionados (do modal) e os
 * carregados (read do master) compartilham o shape `EnderecoParceiroDto`, então o grid
 * os exibe de forma idêntica — antes mesmo de gravar. A gravação cascateia no engine
 * agregado (uma só chamada de save com o master + enderecos).
 */
function EnderecosSection({
  form,
  editavel,
}: {
  form: UseFormReturn<CriarParceiroDto>;
  editavel: boolean;
}) {
  const { fields, append, update, remove } = useFieldArray<CriarParceiroDto, 'enderecos', 'fieldId'>(
    {
      control: form.control,
      name: 'enderecos',
      keyName: 'fieldId',
    },
  );
  // índice em edição (null = modal fechado; -1 = adicionar; >=0 = editar a linha)
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const tipofj = form.watch('tipofj') as TipoFj | undefined;
  // F3 — parceiro estrangeiro → bloqueia a consulta de CEP aos Correios no modal de endereço.
  const estrangeiro = form.watch('estrangeiro') === 'S';

  const onConfirmar = (end: EnderecoParceiroDto) => {
    if (editIdx == null) return;
    if (editIdx < 0) append(end);
    else update(editIdx, end);
    setEditIdx(null);
  };

  const columns = useMemo<DataTableColumnDef<EnderecoParceiroDto & { fieldId: string }>[]>(
    () => [
      { field: 'cep', headerName: 'CEP', type: 'text', width: 110 },
      { field: 'endereco', headerName: 'Logradouro', type: 'text', isPrimary: true },
      { field: 'bairro', headerName: 'Bairro', type: 'text', width: 150 },
      { field: 'cidade', headerName: 'Cidade', type: 'text', width: 150 },
      { field: 'uf', headerName: 'UF', type: 'text', width: 70 },
      { field: 'cnpj_cpf', headerName: 'CNPJ/CPF', type: 'text', width: 160 },
      { field: 'endereco_padrao', headerName: 'Padrão', type: 'status', width: 90 },
      {
        field: 'acoes',
        headerName: '',
        type: 'actions',
        width: 110,
        getActions: ({ row }) => [
          {
            id: 'editar',
            label: 'Editar',
            icon: <Pencil className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            onClick: (r) => {
              const idx = fields.findIndex((f) => f.fieldId === (r as any).fieldId);
              if (idx >= 0) setEditIdx(idx);
            },
          },
          {
            id: 'remover',
            label: 'Remover',
            icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            destructive: true,
            onClick: (r) => {
              const idx = fields.findIndex((f) => f.fieldId === (r as any).fieldId);
              if (idx >= 0) remove(idx);
            },
          },
        ],
      },
    ],
    [fields, remove],
  );

  return (
    <fieldset
      disabled={!editavel}
      className="rounded-radius-base border border-border p-pad-md"
    >
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Endereços</legend>
      <div className="flex flex-col gap-gp-sm">
        <div>
          <Button label="Adicionar &endereço" variant="soft" onClick={() => setEditIdx(-1)} />
        </div>

        {fields.length === 0 ? (
          <small className="text-fg-muted">Sem endereços cadastrados.</small>
        ) : (
          <DataTable
            rows={fields as Array<EnderecoParceiroDto & { fieldId: string }>}
            columns={columns}
            getRowId={(r) => r.fieldId}
            toolbar={{ enableSearch: false, enableFilters: false }}
            paginationConfig={{ enabled: true, initialPageSize: 10 }}
            cardBreakpoint={false}
          />
        )}
      </div>

      {editIdx != null && (
        <EnderecoModal
          inicial={editIdx >= 0 ? (fields[editIdx] as EnderecoParceiroDto) : undefined}
          tipofj={tipofj}
          estrangeiro={estrangeiro}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </fieldset>
  );
}
