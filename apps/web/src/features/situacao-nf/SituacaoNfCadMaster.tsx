import { useState } from 'react';
import { Controller, useFieldArray, type UseFormReturn } from 'react-hook-form';
import {
  situacaoNfSchema, TIPOS_OPERACAO_SITUACAO, regraTipoOperacao, type CriarSituacaoNfDto } from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { Button } from '../../shared/ui/Button';
import { useResourceOptions, type Opcao } from '../../shared/cadmaster/useResourceOptions';
import { LookupField } from '../../shared/ui/LookupField';
import { useLinhasDosCodigos as useNomesDosCodigos } from '../../shared/pesquisa/useLinhasDosCodigos';

type Linha = Record<string, any>;

/** a conta do plano (GET_PLANO_CONTAS) só analítica da empresa: '(CLASSE = ''ANALITICA'') AND (TIPO = ''EMPRESA'')' —
 * UCadSituacaoNF.pas:276 (a grade), :323 e :330 (as contas da baixa). A view do destino guarda os códigos (A/T, E/R). */
const FIXOS_CONTA = { classe: 'A', tipo: 'E' };
const descConta = (l: Linha) => `${l.codiexpandido ?? l.codplanocontas} - ${l.descricao ?? ''}`;

/** o campo de lookup de um detalhe de código (CFOP, centro de custo, parceiro) */
interface LookupDetalhe {
  label: string;
  recurso: string;
  campoCodigo: string; campoDigitado?: string;
  descricao: string | ((l: Linha) => string);
  fixos?: Record<string, string | number>;
  parametros?: Record<string, string | number | null | undefined>;
}

const OPERACOES = Object.entries(TIPOS_OPERACAO_SITUACAO).map(([v, l]) => ({ value: v, label: `${v} - ${l}` }));
const TIPOS = [{ value: 'E', label: 'Entrada' }, { value: 'S', label: 'Saída' }, { value: 'T', label: 'T' }];
// o combo de importação automática da NF-e (CarregaConfiguracoesNotaFiscal, UCadSituacaoNF.pas:740)
const IMPORTACAO_E = [{ value: 'DE', label: 'Devolução de vendas' }, { value: 'PD', label: 'Pedido de compra' }];
const IMPORTACAO_S = [
  { value: 'DC', label: 'Devolução de compra' }, { value: 'IN', label: 'Inventário' }, { value: 'PE', label: 'Pedido' },
  { value: 'PP', label: 'Pedido de produção' }, { value: 'PC', label: 'Pedido de compra' }, { value: 'SC', label: 'Scrap' },
  { value: 'TR', label: 'Transferência' }, { value: 'TO', label: 'Trocas' }, { value: 'VE', label: 'Vendas' },
];

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

  const { data: historicoOptions = [] } = useResourceOptions('cadastro/historico-contabil',
    (h: any) => ({ value: String(h.codhistorico ?? h.codigo), label: `${h.codhistorico ?? h.codigo} - ${h.descricao ?? ''}` }));
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
  // as contas da baixa (Outras configurações): o campo de lookup do plano de contas
  const conta = (name: 'codplanocontas_deb_baixa_cp' | 'codplanocontas_cred_baixa_cr', label: string, desabilitado: boolean) => (
    <Controller control={form.control} name={name as any} render={({ field }) => (
      <LookupField label={label} recurso="lookup/plano-contas" campoDigitado="codireduzido" campoCodigo="codplanocontas" descricao={descConta} fixos={FIXOS_CONTA}
        value={field.value ?? undefined} onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)}
        disabled={!editavel || desabilitado} error={(form.formState.errors as any)[name]?.message as string | undefined} />
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
          <Field label="Descrição" maxLength={100} disabled={!editavel}
            error={form.formState.errors.descricao?.message as string | undefined} {...form.register('descricao')} />
        </div>
        <div className="sm:col-span-2">
          <Controller control={form.control} name="tipo_operacao" render={({ field }) => (
            <SelectField label="Tipo de operação" options={OPERACOES} value={field.value ?? undefined}
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

      <ContasSection form={form} editavel={editavel} contaFixa={regra.contaFixa} historicoOptions={historicoOptions} />

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
        // UCadSituacaoNF.pas:398 — GET_CFOP, TIPO = o tipo da situação
        <ListaDetalhe form={form} editavel={editavel} nome="cfops" campo="codcfop" titulo="CFOPs permitidos" rotuloAdicionar="Adicionar CFOP"
          lookup={{ label: 'CFOP', recurso: 'lookup/cfops', campoCodigo: 'codcfop', descricao: 'descricao', fixos: { tipo } }} />
      )}
      {regra.abas.centroCusto && (
        // UCadSituacaoNF.pas:342-370 — GET_PLC, CHARACTER_LENGTH(CODIGO_EXTENSO) = a máscara da empresa (lancavel) e TIPO_CONTA =
        // 'DESPESA' (1) na E02, senão 'RECEITA' (0) na saída e 'DESPESA' (1) na entrada
        <ListaDetalhe form={form} editavel={editavel} nome="centros_custo" campo="codplc" titulo="Centros de custo" rotuloAdicionar="Adicionar centro de custo"
          lookup={{ label: 'Centro de custo', recurso: 'lookup/plc', campoCodigo: 'codplc', campoDigitado: 'desccodplc', descricao: 'descricao',
            fixos: { tpconta: operacao === 'E02' ? 1 : tipo === 'S' ? 0 : 1 }, parametros: { lancavel: 'S' } }} />
      )}
      {regra.abas.parceiros && (
        // UCadSituacaoNF.pas:288-311 — GET_PARCEIROS, FRN = 'S' na F04 e (CLI = 'S' OR FRN = 'S') na F05; nas outras, sem filtro
        <ListaDetalhe form={form} editavel={editavel} nome="parceiros" campo="codparceiro" titulo="Parceiros" rotuloAdicionar="Adicionar parceiro"
          lookup={{ label: 'Parceiro', recurso: 'lookup/parceiros', campoCodigo: 'codparceiro', descricao: (l) => l.razao ?? l.fantasia ?? '',
            fixos: operacao === 'F04' ? { frn: 'S' } : operacao === 'F05' ? { 'cli|frn': 'S' } : undefined }} />
      )}

      {regra.abas.outras && (
        <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
          <legend className="px-pad-xs text-body-sm font-semibold">Outras configurações</legend>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
            {conta('codplanocontas_deb_baixa_cp', 'Conta débito na baixa do contas a pagar', !regra.debBaixaCP)}
            {conta('codplanocontas_cred_baixa_cr', 'Conta crédito na baixa do contas a receber', !regra.credBaixaCR)}
            {sel('idsituacao_nf_financeiro', 'Situação do financeiro', sitFinOptions)}
          </div>
        </fieldset>
      )}
    </div>
  );
}

/** a grade "Plano de contas" da aba Principal (ITENS_INTEGRACAO_CONTABIL): nenhuma ou uma crédito e uma débito */
function ContasSection({ form, editavel, contaFixa, historicoOptions }: {
  form: UseFormReturn<CriarSituacaoNfDto>; editavel: boolean; contaFixa: boolean; historicoOptions: Opcao[];
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
                <LookupField label="Conta contábil" recurso="lookup/plano-contas" campoDigitado="codireduzido" campoCodigo="codplanocontas" descricao={descConta} fixos={FIXOS_CONTA}
                  value={field.value ?? undefined} onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)} disabled={!editavel} />
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

/** lista simples de um detalhe de código (CFOP, centro de custo, parceiro): o campo de lookup (código + Pesquisa) e adiciona;
 * repetido é ignorado. A lista mostra o nome só dos códigos dela. */
function ListaDetalhe({ form, editavel, nome, campo, titulo, lookup, rotuloAdicionar }: {
  form: UseFormReturn<CriarSituacaoNfDto>; editavel: boolean; nome: 'cfops' | 'centros_custo' | 'parceiros'; campo: string;
  titulo: string; lookup: LookupDetalhe; rotuloAdicionar: string;
}) {
  const { fields, append, remove } = useFieldArray<CriarSituacaoNfDto, typeof nome, 'fieldId'>({ control: form.control, name: nome, keyName: 'fieldId' });
  const [escolhido, setEscolhido] = useState<string | undefined>(undefined);
  const nomes = useNomesDosCodigos(lookup.recurso, lookup.campoCodigo, fields.map((f) => (f as any)[campo]));
  const rotulo = (v: unknown) => {
    const l = nomes?.get(String(v ?? '').trim());
    if (!l) return String(v ?? '');
    return `${v} - ${typeof lookup.descricao === 'function' ? lookup.descricao(l) : String(l[lookup.descricao] ?? '')}`;
  };
  const adicionar = () => {
    const v = Number(escolhido);
    if (!v) return;
    if (!fields.some((f) => Number((f as any)[campo]) === v)) append({ [campo]: v } as any);
    setEscolhido(undefined);
  };
  return (
    <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold">{titulo}</legend>
      <div className="flex flex-col gap-gp-sm">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="min-w-80 flex-1">
            <LookupField label={lookup.label} recurso={lookup.recurso} campoCodigo={lookup.campoCodigo} campoDigitado={lookup.campoDigitado} descricao={lookup.descricao} fixos={lookup.fixos}
              parametros={lookup.parametros} value={escolhido} onChange={(cod) => setEscolhido(cod?.trim() || undefined)} disabled={!editavel} />
          </div>
          <Button label={rotuloAdicionar} variant="soft" onClick={adicionar} />
        </div>
        {fields.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Nenhum.</p>
        ) : (
          <ul className="flex flex-col gap-gp-2xs">
            {fields.map((f, i) => (
              <li key={f.fieldId} className="flex items-center justify-between rounded-radius-base border border-border-subtle px-pad-sm py-pad-xs text-body-sm">
                <span>{rotulo((f as any)[campo])}</span>
                <Button label="Remover" variant="ghost" onClick={() => remove(i)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </fieldset>
  );
}
