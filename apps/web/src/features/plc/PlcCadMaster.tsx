import { useEffect, useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { plcSchema, type CriarPlcDto } from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { LookupField } from '../../shared/ui/LookupField';
import { useShortcut } from '../../shared/keyboard';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/**
 * Cadastro do Centro de Custos (uCadPLC) — o plano gerencial em árvore. A conta pendura numa conta retrocedente (vazia = conta raiz) e o
 * código dela começa pelo do pai; o nível e a descrição contábil vêm no gravar. Excluir é lógico e recusado com conta filha ou com o
 * centro de custo em uso (lançamentos, títulos, baixas, empresas, contas correntes, formas de pagamento).
 * As regras da tela (uCadPLC.pas): o código só se digita na inclusão (`dsPLCDataChange`) e a conta derivada já nasce com o código do pai
 * (`ContaDerivada1Click`); o "Lançamento contábil" só aparece com LANCAMENTO_CONTABIL_NO_CENTRO_CUSTO = 'S' e "Visualizado apenas por
 * proprietários" só para o PRO, e só na conta raiz (`FormShow`/`VerificaCheckProprietarios`); uso de setor, perda, obriga motivo e "não
 * mostrar scrap" só no último nível (`ControlaCheckVinculadoAoUltimoNivel`: tem retrocedente e nenhuma filha).
 */
const TIPOS = [{ value: '0', label: '1 - Receita' }, { value: '1', label: '2 - Despesa' }, { value: '2', label: '3 - Neutra' }];
const FLAGS: Array<[keyof CriarPlcDto, string]> = [
  ['apenas_proprietario', 'Visualizado apenas por proprietários'],
  ['flg_uso_setor', 'Uso de setor'],
  ['flg_perda', 'Perda'],
  ['plc_obriga_motivo_perda', 'Obriga motivo da perda'],
  ['nao_mostrar_scrap_rel_partset', 'Não mostrar no relatório de participação por setor (SCRAP)'],
];

export function PlcCadMaster() {
  return (
    <CadMaster<CriarPlcDto>
      titulo="Centro de custos"
      resourcePath="cadastro/plc"
      pk="codplc"
      viewPk="codigo"
      log={{ form: 'FRMCADPLC', chave: 'CODPLC' }}
      colunasPesquisa={[
        { campo: 'codigo_extenso', label: 'Conta', tipo: 'text', largura: 140 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
        { campo: 'nivel_conta', label: 'Nível', tipo: 'text', largura: 80 },
      ]}
      schema={plcSchema}
      defaultValues={{ descricao: '', desccodplc: '' }}
      campos={({ form, editavel, novo }) => <CamposPlc form={form} editavel={editavel} novo={novo} />}
    />
  );
}

/** os campos do uCadPLC, com o que a tela decide ao abrir (`GET cadastro/plc-tela`) e o estado da conta carregada */
export function CamposPlc({ form, editavel, novo }: { form: UseFormReturn<CriarPlcDto>; editavel: boolean; novo?: () => void }) {
  const [tela, setTela] = useState<{ lancamentoContabil: boolean; proprietario: boolean }>({ lancamentoContabil: false, proprietario: false });
  useEffect(() => {
    fetch(`${BASE}/cadastro/plc-tela`, { headers: apiHeaders() })
      .then(async (r) => { handle401(r); if (r.ok) setTela((await r.json()) as typeof tela); })
      .catch(() => undefined);
  }, []);
  const valores = form.watch() as Record<string, unknown>;
  const incluindo = valores.codplc == null || valores.codplc === '';
  const temPai = valores.codpai != null && valores.codpai !== '';
  const ultimoNivel = incluindo ? temPai : valores.ultimo_nivel === true;
  return (
    <div className="flex flex-col gap-form-gap">
      <TeclasDoPlc novo={novo} />
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
        {/* o pai, no legado, é o nó da árvore (uCadPLC.pas:457, 644-646) — sem Pesquisa nem filtro; vazio = conta raiz. Na inclusão a conta
            derivada nasce com o código do pai (ContaDerivada1Click) */}
        <Controller control={form.control} name="codpai" render={({ field }) => (
          <LookupField label="Conta retrocedente" recurso="lookup/plc" campoCodigo="codplc" descricao={(l) => `${l.desccodplc ?? ''} - ${l.descricao ?? ''}`}
            value={field.value != null && field.value !== '' ? String(field.value) : undefined}
            onChange={(cod, linha) => {
              field.onChange(cod ? Number(cod) : '');
              if (incluindo && linha?.desccodplc) form.setValue('desccodplc', String(linha.desccodplc));
            }} disabled={!editavel} />
        )} />
        <Field label="Código da conta" disabled={!editavel || !incluindo} maxLength={30} error={form.formState.errors.desccodplc?.message as string | undefined} {...form.register('desccodplc')} />
        <Controller control={form.control} name="tpconta" render={({ field }) => (
          <SelectField label="Tipo" options={TIPOS} value={field.value != null && field.value !== '' ? String(field.value) : undefined}
            onChange={(v) => field.onChange(v === '' || v == null ? '' : Number(v))} placeholder="—" disabled={!editavel} />
        )} />
        <div className="sm:col-span-2">
          <Field label="Descrição" disabled={!editavel} maxLength={80} error={form.formState.errors.descricao?.message as string | undefined} {...form.register('descricao')} />
        </div>
        <Controller control={form.control} name="limiteplc" render={({ field }) => (
          <NumberField label="Limite" value={field.value != null ? Number(field.value) : undefined} onChange={field.onChange} decimais={2} disabled={!editavel} />
        )} />
        {tela.lancamentoContabil && (
          <div className="sm:col-span-3">
            {/* uCadPLC.pas:159 — GET_PLANO_CONTAS, CLASSE='ANALITICA' (o texto da view do legado) */}
            <Controller control={form.control} name="codcontabil" render={({ field }) => (
              <LookupField label="Lançamento contábil" recurso="lookup/plano-contas" campoDigitado="codireduzido" campoCodigo="codplanocontas" descricao="descricao_completa"
                fixos={{ classe: 'ANALITICA' }} value={field.value != null && field.value !== '' ? String(field.value) : undefined}
                onChange={(cod) => field.onChange(cod ? Number(cod) : '')} disabled={!editavel} />
            )} />
          </div>
        )}
      </div>
      <fieldset className="flex flex-wrap items-center gap-gp-lg" aria-label="Marcações">
        {FLAGS.filter(([name]) => name !== 'apenas_proprietario' || tela.proprietario).map(([name, label]) => (
          <Controller key={name} control={form.control} name={name as never} render={({ field }: any) => (
            <CheckboxField label={label} value={(field.value as string | undefined) ?? 'N'} onChange={field.onChange}
              disabled={!editavel || (name === 'apenas_proprietario' ? temPai : !ultimoNivel)} />
          )} />
        ))}
      </fieldset>
    </div>
  );
}

/**
 * As teclas próprias do uCadPLC (ShortCut dos itens do `ppmPLC`, o menu da árvore):
 *  - Ctrl+Ins "Inserir conta raiz" → o Adicionar (aqui a conta nasce sem retrocedente = raiz); só com o Adicionar habilitado.
 * Shift+Ins "Inserir conta derivada" e Ctrl+I "Inserir composição da conta" não têm ação equivalente nesta tela (sem a árvore).
 */
function TeclasDoPlc({ novo }: { novo?: () => void }) {
  // Ctrl+Ins = ContaRaiz1Click (TMenuItem ContaRaiz1, ShortCut 16429, do uCadPLC)
  useShortcut('ctrl+insert', () => novo?.(), { when: !!novo });
  return null;
}
