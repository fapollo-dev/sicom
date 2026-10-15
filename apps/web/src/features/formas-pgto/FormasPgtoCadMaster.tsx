import { useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { NumberField } from '../../shared/ui/NumberField';
import { Button } from '../../shared/ui/Button';
import { Tabs } from '../../shared/ui/Tabs';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { LookupField } from '../../shared/ui/LookupField';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';
import { ListaPesquisada } from '../../shared/pesquisa/ListaPesquisada';
import { formaPgtoSchema, FORMA_PGTO_DESTINO_OPCOES, type CriarFormaPgtoDto } from '@apollo/shared';

// o combo do cbbATALHO (uCadFormaPgto.dfm), na ordem dele
const ATALHOS = 'ABCDEFGHIJKLMNOPQRSTUVXWYZ'.split('').map((l) => ({ value: l, label: l }));
type Item = Record<string, unknown>;

/**
 * FORMAS DE PAGAMENTO (FRMCADFORMAPGTO, uCadFormaPgto.pas/.dfm) via <CadMaster>. empresaScoped (IDEMPRESA), PK IDPGTO por sequence.
 * As três abas do legado: "Formas de Pagamento" (modalidade, atalho A..Z, destino, centro de custo, conta corrente, comissão, troco limite
 * — só TEF/CRT —, desc/acres., código contábil, conta contábil, condição de pagamento, valor mínimo, recebe no PDV, permite sangria,
 * entregas; e o que o binário novo grava: forma pai, exige permissão, baixa automática, lançamento individual), "CFOP" e "Condições de
 * pagamento" (REL_FORMA_PAGAMENTO_CONDICAO). As regras do gravar (atalho único, quebra não recebe no PDV, o Desc/Acres. propagado) vivem
 * na API.
 */
export function FormasPgtoCadMaster() {
  const { data: contaOptions = [] } = useResourceOptions(
    'cadastro/contas-bancarias',
    (c: any) => ({ value: String(c.codconta), label: `${c.nroconta ?? c.codconta} - ${c.titular ?? c.banco ?? ''}` }),
  );

  return (
    <CadMaster<CriarFormaPgtoDto>
      titulo="Formas de Pagamento"
      resourcePath="cadastro/formas-pgto"
      pk="idpgto"
      log={{ form: 'FRMCADFORMAPGTO', chave: 'IDPGTO' }}
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'modalidade', label: 'Modalidade', tipo: 'text' },
        { campo: 'atalho', label: 'Atalho', tipo: 'text', largura: 100 },
        { campo: 'destino', label: 'Destino', tipo: 'text', largura: 120 },
      ]}
      schema={formaPgtoSchema}
      defaultValues={{ recebe_pdv: 'S', permite_sangria_pdv: 'N', inativo: 'N' }}
      campos={({ form, editavel }) => <CamposFormaPgto form={form as unknown as UseFormReturn<Item>} editavel={editavel} contaOptions={contaOptions} />}
    />
  );
}

export function CamposFormaPgto({ form, editavel, contaOptions }: { form: UseFormReturn<Item>; editavel: boolean; contaOptions: Array<{ value: string; label: string }> }) {
  const [aba, setAba] = useState('forma');
  const [pesqContabil, setPesqContabil] = useState(false);
  const destino = String(form.watch('destino') ?? '');
  const atalho = String(form.watch('atalho') ?? '');
  // dtsPrincipalDataChange: o Troco Limite só vale para TEF/CRT (fora deles fica desabilitado e zera)
  const trocoHabilitado = destino === 'TEF' || destino === 'CRT';
  const erro = (k: string) => (form.formState.errors as Record<string, { message?: string } | undefined>)[k]?.message;
  const num = (k: string, label: string, decimais = 2, opts: { disabled?: boolean; min?: number } = {}) => (
    <Controller control={form.control} name={k} render={({ field }) => (
      <NumberField label={label} decimais={decimais} min={opts.min} value={field.value == null ? undefined : Number(field.value)}
        onChange={(v) => field.onChange(v ?? null)} disabled={!editavel || opts.disabled} error={erro(k)} />
    )} />
  );
  const chk = (k: string, label: string, ligado = 'S', desligado = 'N') => (
    <Controller control={form.control} name={k} render={({ field }) => (
      <CheckboxField label={label} value={field.value === ligado ? 'S' : 'N'} onChange={(v) => field.onChange(v === 'S' ? ligado : desligado)} disabled={!editavel} />
    )} />
  );
  const condicoes = ((form.watch('condicoes') as Item[] | undefined) ?? []);

  return (
    <div className="flex flex-col gap-form-gap">
      <Tabs tabs={[{ id: 'forma', label: 'Formas de Pagamento' }, { id: 'cfop', label: 'CFOP' }, { id: 'condicoes', label: 'Condições de pagamento' }]}
        active={aba} onChange={setAba} />
      {aba === 'forma' && (
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          {/* edtMODALIDADEKeyPress: só letras, dígitos e espaço */}
          <Controller control={form.control} name="modalidade" render={({ field }) => (
            <Field label="Modalidade" maxLength={30} disabled={!editavel} error={erro('modalidade')} value={String(field.value ?? '')}
              onChange={(e) => field.onChange(e.target.value.replace(/[^A-Za-z0-9 ]/g, ''))} onBlur={field.onBlur} />
          )} />
          <Controller control={form.control} name="atalho" render={({ field }) => (
            <SelectField label="&Atalho" value={field.value ? String(field.value) : undefined} onChange={field.onChange} disabled={!editavel}
              options={atalho && !ATALHOS.some((a) => a.value === atalho) ? [...ATALHOS, { value: atalho, label: atalho }] : ATALHOS}
              placeholder="Selecione…" error={erro('atalho')} />
          )} />
          <Controller control={form.control} name="destino" render={({ field }) => (
            <SelectField label="&Destino" options={FORMA_PGTO_DESTINO_OPCOES as unknown as Array<{ value: string; label: string }>} value={field.value ? String(field.value) : undefined}
              onChange={(v) => {
                field.onChange(v);
                if (v !== 'TEF' && v !== 'CRT' && Number(form.getValues('troco_limite') ?? 0) !== 0) form.setValue('troco_limite', 0, { shouldDirty: true });
              }}
              placeholder="Selecione o destino…" disabled={!editavel} error={erro('destino')} />
          )} />
          {/* uCadFormaPgto.pas btnBuscaPLCClick — GET_PLC; o filtro do legado (comprimento da máscara) não é igualdade: fica no servidor */}
          <Controller control={form.control} name="plccofre" render={({ field }) => (
            <LookupField label="Centro de &custo" recurso="lookup/plc" campoDigitado="desccodplc" parametros={{ lancavel: 'S' }} campoCodigo="codplc"
              descricao={(l) => `${l.desccodplc ?? l.codplc} - ${l.descricao ?? ''}`} value={field.value as number | undefined}
              onChange={(cod) => field.onChange(cod ? Number(cod) : null)} disabled={!editavel} />
          )} />
          <Controller control={form.control} name="codcontacorrente" render={({ field }) => (
            <SelectField label="Conta co&rrente" options={contaOptions} value={field.value != null ? String(field.value) : undefined}
              onChange={(v) => field.onChange(v ? Number(v) : null)} placeholder="Opcional…" disabled={!editavel} />
          )} />
          <div className="grid grid-cols-3 gap-form-gap">
            {num('comissao', 'Comissão (%)')}
            {num('troco_limite', 'Troco Limite', 2, { disabled: !trocoHabilitado, min: 0 })}
            {num('acre_desc', 'Desc/Acres. (+/-)')}
          </div>
          {/* edtCodContabil + btnBuscaCodContabil (GET_CODCONTABIL): o código digitado, o [F3] e a descrição */}
          <div className="flex items-end gap-gp-xs">
            <div className="flex-1">
              <Field label="Código contábil" maxLength={30} disabled={!editavel} {...form.register('codcontabil')}
                onKeyDown={(e) => { if (e.key === 'F3') { e.preventDefault(); setPesqContabil(true); } }} />
            </div>
            <Button label="…" variant="soft" disabled={!editavel} onClick={() => setPesqContabil(true)} />
            <span className="pb-2 text-body-sm text-fg-muted">{String(form.watch('desccontabil') ?? '')}</span>
          </div>
          {/* EdtPlanoContas → CODPLANOCONTAS — GET_PLANO_CONTAS (CLASSE='ANALITICA') AND (TIPO='EMPRESA') */}
          <Controller control={form.control} name="codplanocontas" render={({ field }) => (
            <LookupField label="Conta contábil" recurso="lookup/plano-contas" campoDigitado="codireduzido" campoCodigo="codplanocontas" descricao="descricao_completa"
              fixos={{ classe: 'ANALITICA', tipo: 'EMPRESA' }} value={field.value as number | undefined}
              onChange={(cod) => field.onChange(cod ? Number(cod) : null)} disabled={!editavel} />
          )} />
          {/* edtCodCondicaoPagto + btnBuscaCondicaoPagto: GET_CONDICOES_PAGTO_FVENDA, abrindo em DESCRICAO em qualquer lugar */}
          <Controller control={form.control} name="codconpagto" render={({ field }) => (
            <LookupField label="Condição de pagamento" recurso="lookup/condicoes-pagto-fvenda" campoCodigo="codigo" descricao="descricao"
              value={field.value as number | undefined} onChange={(cod) => field.onChange(cod ? Number(cod) : null)} disabled={!editavel} />
          )} />
          {num('valor_minimo_fv', 'Vr. mínimo para venda', 2, { min: 0 })}
          {/* gravados pelo binário novo da produção (fora do .dfm de 2020) */}
          <Controller control={form.control} name="idpgto_pai" render={({ field }) => (
            <LookupField label="Forma de pagamento pai" recurso="lookup/formas-pgto" campoCodigo="codigo" descricao="modalidade"
              value={field.value as number | undefined} onChange={(cod) => field.onChange(cod ? Number(cod) : null)} disabled={!editavel} />
          )} />
          <div className="sm:col-span-2 grid grid-cols-2 gap-form-gap sm:grid-cols-4">
            {chk('recebe_pdv', 'Recebe no PDV')}
            {chk('permite_sangria_pdv', 'Permite &sangria')}
            {chk('tipo', 'Entregas', 'E', 'N')}
            {chk('inativo', '&Inativo')}
            {chk('exige_permissao', 'Exige permissão')}
            {chk('baixa_documento_automatico', 'Baixa documento automático')}
            {chk('lanc_movimento_individual', 'Lançamento individual na movimentação')}
          </div>
        </div>
      )}
      {aba === 'cfop' && (
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          {num('cfopdentrodoestado', 'CFOP Dentro do Estado', 0, { min: 0 })}
          {num('cfopforadoestado', 'CFOP Fora do Estado', 0, { min: 0 })}
        </div>
      )}
      {/* BtnAdicionarCondicaoPgto: a Pesquisa da GET_CONDICOES_PAGTO em multisseleção; o que já está na grade é pulado (Locate) */}
      {aba === 'condicoes' && (
        <ListaPesquisada rotulo="Condições de pagamento" itens={condicoes} chave="codconpagto" editavel={editavel}
          colunas={[{ campo: 'codconpagto', rotulo: 'Código condição', largura: 140 }, { campo: 'condicao_pagamento', rotulo: 'Condição de pagamento' }]}
          recurso="lookup/condicoes-pagto" deLinha={(l) => ({ codconpagto: Number(l.codigo), condicao_pagamento: l.descricao ?? null })}
          onChange={(itens) => form.setValue('condicoes', itens as never, { shouldDirty: true })} />
      )}
      {pesqContabil && (
        <Pesquisa resourcePath="lookup/codcontabil" onFechar={() => setPesqContabil(false)}
          onSelecionar={(l) => { form.setValue('codcontabil', String(l.codigo_contabil ?? ''), { shouldDirty: true }); form.setValue('desccontabil', l.descricao ?? '', { shouldDirty: false }); setPesqContabil(false); }} />
      )}
    </div>
  );
}
