import { useState } from 'react';
import { Controller, useFieldArray, type UseFormReturn } from 'react-hook-form';
import {
  situacaoNfSchema, TIPOS_OPERACAO_SITUACAO, regraTipoOperacao, type CriarSituacaoNfDto,
} from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { NumberField } from '../../shared/ui/NumberField';
import { Button } from '../../shared/ui/Button';
import { useResourceOptions, type Opcao } from '../../shared/cadmaster/useResourceOptions';

const OPERACOES = Object.entries(TIPOS_OPERACAO_SITUACAO).map(([v, l]) => ({ value: v, label: `${v} - ${l}` }));
const TIPOS = [{ value: 'E', label: 'Entrada' }, { value: 'S', label: 'Saída' }, { value: 'T', label: 'T' }];
// o combo de importação automática da NF-e (CarregaConfiguracoesNotaFiscal, UCadSituacaoNF.pas:740)
const IMPORTACAO_E = [{ value: 'DE', label: 'Devolução de vendas' }, { value: 'PD', label: 'Pedido de compra' }];
const IMPORTACAO_S = [
  { value: 'DC', label: 'Devolução de compra' }, { value: 'IN', label: 'Inventário' }, { value: 'PE', label: 'Pedido' },
  { value: 'PP', label: 'Pedido de produção' }, { value: 'PC', label: 'Pedido de compra' }, { value: 'SC', label: 'Scrap' },
  { value: 'TR', label: 'Transferência' }, { value: 'TO', label: 'Trocas' }, { value: 'VE', label: 'Vendas' },
];
const rotulo = (ops: Opcao[], v: unknown) => ops.find((o) => String(o.value) === String(v))?.label ?? String(v ?? '');

/**
 * SITUAÇÃO DO DOCUMENTO (`FRMCADSITUACAONF`, UCadSituacaoNF; mig 317). A tela que não existia: o Apollo tinha só a
 * consulta. Principal (descrição, tipo de operação, tipo, plano de contas) + as abas que o tipo de operação liga
 * (`SetTipoOperacao` — `regraTipoOperacao` do shared, a mesma regra que a API aplica): configurações de estoque, CFOP,
 * centros de custo, parceiros e outras configurações.
 */
export function SituacaoNfCadMaster() {
  return (
    <CadMaster<CriarSituacaoNfDto>
      titulo="Situação do Documento"
      resourcePath="cadastro/situacoes-nf"
      pk="idsituacao_nf"
      log={{ form: 'FRMCADSITUACAONF', chave: 'IDSITUACAO_NF' }}
      largura="5xl"
      colunasPesquisa={[
        { campo: 'idsituacao_nf', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
        { campo: 'tipo_operacao', label: 'Operação', tipo: 'text', largura: 110 },
        { campo: 'tipo', label: 'Tipo', tipo: 'text', largura: 80 },
      ]}
      schema={situacaoNfSchema}
      defaultValues={{ tipo: 'E', nao_realiza_integracao: 'N', ativo: 'S', cfops: [], centros_custo: [], parceiros: [], contas: [] }}
      campos={({ form, editavel }) => <Campos form={form} editavel={editavel} />}
    />
  );
}

function Campos({ form, editavel }: { form: UseFormReturn<CriarSituacaoNfDto>; editavel: boolean }) {
  const operacao = form.watch('tipo_operacao') as string | undefined;
  const regra = regraTipoOperacao(operacao);
  const tipo = (form.watch('tipo') as string | undefined) ?? 'E';

  const { data: contaOptions = [] } = useResourceOptions('cadastro/plano-contas',
    (p: any) => ({ value: String(p.codplanocontas), label: `${p.codiexpandido ?? p.codplanocontas} - ${p.descricao ?? ''}` }),
    { campo: 'classe', operador: 'igual', valor: 'A' });
  const { data: historicoOptions = [] } = useResourceOptions('cadastro/historico-contabil',
    (h: any) => ({ value: String(h.codhistorico ?? h.codigo), label: `${h.codhistorico ?? h.codigo} - ${h.descricao ?? ''}` }));
  const { data: cfopOptions = [] } = useResourceOptions('cadastro/cfops',
    (c: any) => ({ value: String(c.codcfop), label: `${c.codcfop} - ${c.descricao ?? ''}` }));
  const { data: plcOptions = [] } = useResourceOptions('cadastro/plc',
    (p: any) => ({ value: String(p.codplc ?? p.codigo), label: `${p.codplc ?? p.codigo} - ${p.descricao ?? ''}` }));
  const { data: parceiroOptions = [] } = useResourceOptions('cadastro/parceiros',
    (p: any) => ({ value: String(p.codparceiro), label: `${p.codparceiro} - ${p.razao ?? p.fantasia ?? ''}` }),
    operacao === 'F04' ? { campo: 'frn', operador: 'igual', valor: 'S' } : undefined);
  const { data: formaOptions = [] } = useResourceOptions('cadastro/formas-pgto',
    (f: any) => ({ value: String(f.idpgto), label: `${f.idpgto} - ${f.modalidade ?? ''}` }));
  const { data: operadoraOptions = [] } = useResourceOptions('cadastro/operadoras',
    (o: any) => ({ value: String(o.codoperadoras ?? o.codigo), label: `${o.codoperadoras ?? o.codigo} - ${o.descricao ?? o.nome ?? ''}` }));
  const { data: sitFinOptions = [] } = useResourceOptions('cadastro/situacoes-nf',
    (s: any) => ({ value: String(s.idsituacao_nf), label: `${s.idsituacao_nf} - ${s.descricao ?? ''}` }),
    { campo: 'tipo_operacao', operador: 'igual', valor: tipo === 'E' ? 'F04' : 'F05' });

  const sel = (name: keyof CriarSituacaoNfDto, label: string, options: Opcao[], opts?: { disabled?: boolean }) => (
    <Controller control={form.control} name={name as any} render={({ field }) => (
      <SelectField label={label} options={options} value={field.value != null ? String(field.value) : undefined}
        onChange={(v) => field.onChange(v === '' || v == null ? undefined : /^\d+$/.test(v) && name !== 'importacao_auto_nf' ? Number(v) : v)}
        disabled={!editavel || opts?.disabled} placeholder="—"
        error={(form.formState.errors as any)[name]?.message as string | undefined} />
    )} />
  );
  const flag = (name: keyof CriarSituacaoNfDto, label: string) => (
    <Controller control={form.control} name={name as any} render={({ field }) => (
      <CheckboxField label={label} value={field.value as string | undefined} onChange={field.onChange} disabled={!editavel} />
    )} />
  );

  return (
    <div className="flex flex-col gap-gp-md">
      <section className="grid grid-cols-1 gap-form-gap sm:grid-cols-6">
        <div className="sm:col-span-3">
          <Field label="&Descrição" maxLength={100} disabled={!editavel}
            error={form.formState.errors.descricao?.message as string | undefined} {...form.register('descricao')} />
        </div>
        <div className="sm:col-span-2">
          <Controller control={form.control} name="tipo_operacao" render={({ field }) => (
            <SelectField label="Tipo de &operação" options={OPERACOES} value={field.value ?? undefined}
              onChange={(v) => {
                field.onChange(v);
                const f = regraTipoOperacao(v).tipoForcado;
                if (f) form.setValue('tipo', f);
              }}
              disabled={!editavel} placeholder="Selecione…"
              error={form.formState.errors.tipo_operacao?.message as string | undefined} />
          )} />
        </div>
        <div className="sm:col-span-1">{sel('tipo', '&Tipo', TIPOS, { disabled: regra.tipoForcado != null })}</div>
        <div className="flex flex-wrap items-center gap-gp-md sm:col-span-6">
          {flag('nao_realiza_integracao', 'Não realiza &integração contábil')}
          {flag('ativo', 'A&tiva')}
        </div>
      </section>

      <ContasSection form={form} editavel={editavel} contaFixa={regra.contaFixa} contaOptions={contaOptions} historicoOptions={historicoOptions} />

      {regra.abas.estoque && (
        <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
          <legend className="px-pad-xs text-body-sm font-semibold">Configurações de estoque</legend>
          <div className="flex flex-wrap items-center gap-gp-md">
            {flag('exige_pedido_compra', 'Exige pedido de compra')}
            {flag('valida_estoque_disponivel', 'Valida estoque disponível')}
            {flag('transferencia_mercadorias', 'Transferência de mercadorias')}
            {flag('permite_basecalc_maior100', 'Permite base de cálculo maior que 100%')}
          </div>
          <div className="mt-form-gap grid grid-cols-1 gap-form-gap sm:grid-cols-3">
            {sel('importacao_auto_nf', 'Importação automática da NF-e', tipo === 'E' ? IMPORTACAO_E : IMPORTACAO_S)}
            {sel('idpgto_nfe', 'Forma de pagamento da NF-e', formaOptions)}
            {sel('codoperadoras_nfe', 'Operadora da NF-e', operadoraOptions)}
          </div>
        </fieldset>
      )}

      {regra.abas.cfop && (
        <ListaDetalhe form={form} editavel={editavel} nome="cfops" campo="codcfop" titulo="CFOPs permitidos" opcoes={cfopOptions} rotuloAdicionar="Adicionar CFOP" />
      )}
      {regra.abas.centroCusto && (
        <ListaDetalhe form={form} editavel={editavel} nome="centros_custo" campo="codplc" titulo="Centros de custo" opcoes={plcOptions} rotuloAdicionar="Adicionar centro de custo" />
      )}
      {regra.abas.parceiros && (
        <ListaDetalhe form={form} editavel={editavel} nome="parceiros" campo="codparceiro" titulo="Parceiros" opcoes={parceiroOptions} rotuloAdicionar="Adicionar parceiro" />
      )}

      {regra.abas.outras && (
        <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
          <legend className="px-pad-xs text-body-sm font-semibold">Outras configurações</legend>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
            {sel('codplanocontas_deb_baixa_cp', 'Conta débito na baixa do contas a pagar', contaOptions, { disabled: !regra.debBaixaCP })}
            {sel('codplanocontas_cred_baixa_cr', 'Conta crédito na baixa do contas a receber', contaOptions, { disabled: !regra.credBaixaCR })}
            {sel('idsituacao_nf_financeiro', 'Situação do financeiro', sitFinOptions)}
          </div>
        </fieldset>
      )}
    </div>
  );
}

/** a grade "Plano de contas" da aba Principal (ITENS_INTEGRACAO_CONTABIL): nenhuma ou uma crédito e uma débito */
function ContasSection({ form, editavel, contaFixa, contaOptions, historicoOptions }: {
  form: UseFormReturn<CriarSituacaoNfDto>; editavel: boolean; contaFixa: boolean; contaOptions: Opcao[]; historicoOptions: Opcao[];
}) {
  const { fields, append, remove } = useFieldArray<CriarSituacaoNfDto, 'contas', 'fieldId'>({ control: form.control, name: 'contas', keyName: 'fieldId' });
  return (
    <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold">Plano de contas (integração contábil)</legend>
      <div className="flex flex-col gap-gp-sm">
        {fields.map((f, i) => (
          <div key={f.fieldId} className="grid grid-cols-1 items-end gap-form-gap sm:grid-cols-12">
            <div className="sm:col-span-2">
              <Controller control={form.control} name={`contas.${i}.natureza` as const} render={({ field }) => (
                <SelectField label="Natureza" options={[{ value: 'D', label: 'Débito' }, { value: 'C', label: 'Crédito' }]} value={field.value} onChange={field.onChange} disabled={!editavel} />
              )} />
            </div>
            <div className="sm:col-span-2">
              <Controller control={form.control} name={`contas.${i}.tipo` as const} render={({ field }) => (
                <SelectField label="Conta" options={[{ value: 'F', label: 'Fixa' }, { value: 'A', label: 'Automática' }]}
                  value={contaFixa ? 'F' : field.value} onChange={field.onChange} disabled={!editavel || contaFixa} />
              )} />
            </div>
            <div className="sm:col-span-4">
              <Controller control={form.control} name={`contas.${i}.codconta_contabil` as const} render={({ field }) => (
                <SelectField label="Conta contábil" options={contaOptions} value={field.value != null ? String(field.value) : undefined}
                  onChange={(v) => field.onChange(v ? Number(v) : undefined)} disabled={!editavel} placeholder="—" />
              )} />
            </div>
            <div className="sm:col-span-3">
              <Controller control={form.control} name={`contas.${i}.codhistorico` as const} render={({ field }) => (
                <SelectField label="Histórico" options={historicoOptions} value={field.value != null ? String(field.value) : undefined}
                  onChange={(v) => field.onChange(v ? Number(v) : undefined)} disabled={!editavel} placeholder="—" />
              )} />
            </div>
            <div className="sm:col-span-1"><Button label="Remover" variant="ghost" onClick={() => remove(i)} /></div>
          </div>
        ))}
        {fields.length < 2 && (
          <div>
            <Button label="Adicionar conta" variant="soft"
              onClick={() => append({ natureza: fields.some((x) => x.natureza === 'D') ? 'C' : 'D', tipo: 'F' } as any)} />
          </div>
        )}
      </div>
    </fieldset>
  );
}

/** lista simples de um detalhe de código (CFOP, centro de custo, parceiro): escolhe e adiciona, repetido é ignorado */
function ListaDetalhe({ form, editavel, nome, campo, titulo, opcoes, rotuloAdicionar }: {
  form: UseFormReturn<CriarSituacaoNfDto>; editavel: boolean; nome: 'cfops' | 'centros_custo' | 'parceiros'; campo: string;
  titulo: string; opcoes: Opcao[]; rotuloAdicionar: string;
}) {
  const { fields, append, remove } = useFieldArray<CriarSituacaoNfDto, typeof nome, 'fieldId'>({ control: form.control, name: nome, keyName: 'fieldId' });
  const [escolhido, setEscolhido] = useState<string | undefined>(undefined);
  const [digitado, setDigitado] = useState<number | undefined>(undefined);
  const adicionar = () => {
    const v = Number(escolhido ?? digitado);
    if (!v) return;
    if (!fields.some((f) => Number((f as any)[campo]) === v)) append({ [campo]: v } as any);
    setEscolhido(undefined);
    setDigitado(undefined);
  };
  return (
    <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold">{titulo}</legend>
      <div className="flex flex-col gap-gp-sm">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="min-w-64"><SelectField label="Escolher" options={opcoes} value={escolhido} onChange={(v) => setEscolhido(v || undefined)} placeholder="Selecione…" /></div>
          <div className="w-36"><NumberField label="ou o código" value={digitado} onChange={setDigitado} decimais={0} min={0} /></div>
          <Button label={rotuloAdicionar} variant="soft" onClick={adicionar} />
        </div>
        {fields.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Nenhum.</p>
        ) : (
          <ul className="flex flex-col gap-gp-2xs">
            {fields.map((f, i) => (
              <li key={f.fieldId} className="flex items-center justify-between rounded-radius-base border border-border-subtle px-pad-sm py-pad-xs text-body-sm">
                <span>{rotulo(opcoes, (f as any)[campo])}</span>
                <Button label="Remover" variant="ghost" onClick={() => remove(i)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </fieldset>
  );
}
