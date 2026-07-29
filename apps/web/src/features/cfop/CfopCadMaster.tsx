import { Controller } from 'react-hook-form';
import { cfopSchema, type CriarCfopDto } from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';

/**
 * Cadastro de CFOP (UCadCFOP) — corte "CFOP × SITUAÇÃO". Chave natural (codcfop digitado). Além da descrição,
 * gerencia a aba "Situação do documento": a SITUACAO_NF que "refina" o CFOP por imposto (ICMS/PIS/COFINS) e
 * sentido (entrada/saída) — cada uma FK → situacao_nf, que alimenta a derivação fiscal/contábil da NF. Também
 * o CFOP de devolução (auto-lookup) e as flags proc_cupom / gera_financeiro_auto.
 *
 * ADIADO (procedência — campos do UCadCFOP AUSENTES na tabela cfop do monorepo; precisariam de migração):
 * CODCONTABIL/CODIREDUZIDO (conta contábil), ALIQUOTA/ICM_EFETIVO (grid de alíquota), TIPO/TIPOESTADO,
 * PROC_FINANCEIRO/PROC_QTDE/PROC_TRANSF, SINTEGRA, NAO_GERA_SPED, NAO_GERA_APURACAO_ICMS, ALTERA_CUSTO_NF,
 * ATUALIZA_VENDA_NF.
 */
export function CfopCadMaster() {
  const { data: situacaoOptions = [] } = useResourceOptions(
    'cadastro/situacoes-nf',
    (s: any) => ({ value: String(s.idsituacao_nf), label: `${s.idsituacao_nf} - ${s.descricao}` }),
  );
  const { data: cfopOptions = [] } = useResourceOptions('cadastro/cfops', (c: any) => ({
    value: String(c.codcfop),
    label: `${c.codcfop} - ${c.descricao}`,
  }));

  const sitField = (name: keyof CriarCfopDto, label: string, form: any, editavel: boolean) => (
    <Controller
      control={form.control}
      name={name as never}
      render={({ field }: any) => (
        <SelectField
          label={label}
          options={situacaoOptions}
          value={field.value != null ? String(field.value) : undefined}
          onChange={(v) => field.onChange(v ? Number(v) : undefined)}
          placeholder="Selecione a situação…"
        />
      )}
    />
  );

  return (
    <CadMaster<CriarCfopDto>
      titulo="CFOP"
      resourcePath="cadastro/cfops"
      pk="codcfop"
      pkGerada={false} // chave natural: o usuário digita o CFOP (4 dígitos)
      colunasPesquisa={[
        { campo: 'codcfop', label: 'CFOP', tipo: 'text', largura: 110 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
      ]}
      schema={cfopSchema}
      defaultValues={{ descricao: '' }}
      campos={({ form, editavel }) => (
        <div className="flex flex-col gap-form-gap">
          <Field
            label="&Descrição"
            disabled={!editavel}
            error={form.formState.errors.descricao?.message as string | undefined}
            {...form.register('descricao')}
          />

          {/* Aba "Situação do documento" — CFOP × SITUAÇÃO por imposto e sentido. */}
          <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
            <legend className="px-pad-xs text-fg-muted">Situação do documento (CFOP × situação)</legend>
            <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
              {sitField('situacao_icms_entradas_nf', 'ICMS — notas de &entrada', form, editavel)}
              {sitField('situacao_icms_saidas_nf', 'ICMS — notas de &saída', form, editavel)}
              {sitField('situacao_pis_entradas_nf', 'PIS — notas de entrada', form, editavel)}
              {sitField('situacao_pis_saidas_nf', 'PIS — notas de saída', form, editavel)}
              {sitField('situacao_cofins_entradas_nf', 'COFINS — notas de entrada', form, editavel)}
              {sitField('situacao_cofins_saidas_nf', 'COFINS — notas de saída', form, editavel)}
              {sitField('idsituacao_nf_saida', 'Situação padrão (saída)', form, editavel)}
            </div>
          </fieldset>

          {/* Devolução + flags. */}
          <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
            <legend className="px-pad-xs text-fg-muted">Devolução e processamento</legend>
            <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
              <Controller
                control={form.control}
                name="cfop_devolucao"
                render={({ field }) => (
                  <SelectField
                    label="CFOP para &devolução de compra"
                    options={cfopOptions}
                    value={field.value ?? undefined}
                    onChange={(v) => field.onChange(v || undefined)}
                    placeholder="Selecione o CFOP…"
                  />
                )}
              />
              <div className="flex flex-wrap items-center gap-gp-lg">
                <Controller
                  control={form.control}
                  name="proc_cupom"
                  render={({ field }) => (
                    <CheckboxField
                      label="Zerar ICMS Cupom/Sintegra/Sped"
                      value={(field.value as string | undefined) ?? 'N'}
                      onChange={field.onChange}
                      disabled={!editavel}
                    />
                  )}
                />
                <Controller
                  control={form.control}
                  name="gera_financeiro_auto"
                  render={({ field }) => (
                    <CheckboxField
                      label="Gera financeiro automaticamente"
                      value={(field.value as string | undefined) ?? 'N'}
                      onChange={field.onChange}
                      disabled={!editavel}
                    />
                  )}
                />
              </div>
            </div>
          </fieldset>
        </div>
      )}
    />
  );
}
