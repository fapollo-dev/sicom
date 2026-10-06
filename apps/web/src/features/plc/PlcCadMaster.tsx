import { Controller } from 'react-hook-form';
import { plcSchema, type CriarPlcDto } from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { useShortcut } from '../../shared/keyboard';

/**
 * Cadastro do Centro de Custos (uCadPLC) — o plano gerencial em árvore. A conta pendura numa conta retrocedente (vazia = conta raiz) e o
 * código dela começa pelo do pai; o nível e a descrição contábil vêm no gravar. Excluir é lógico e recusado com conta filha ou com o
 * centro de custo em uso (lançamentos, títulos, baixas, empresas, contas correntes, formas de pagamento).
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
  const { data: plcs = [] } = useResourceOptions('cadastro/plc', (p: any) => ({ value: String(p.codplc), label: `${p.desccodplc ?? ''} - ${p.descricao ?? ''}` }));
  const { data: contas = [] } = useResourceOptions('cadastro/plano-contas', (p: any) => ({ value: String(p.codplanocontas), label: `${p.codiexpandido ?? p.codplanocontas} - ${p.descricao ?? ''}` }),
    { campo: 'classe', operador: 'igual', valor: 'A' });

  return (
    <CadMaster<CriarPlcDto>
      titulo="Centro de custos"
      resourcePath="cadastro/plc"
      pk="codplc"
      viewPk="codigo"
      log={{ form: 'FRMCADPLC', chave: 'CODPLC' }}
      colunasPesquisa={[
        { campo: 'desccodplc', label: 'Conta', tipo: 'text', largura: 140 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
        { campo: 'nivelconta', label: 'Nível', tipo: 'text', largura: 80 },
      ]}
      schema={plcSchema}
      defaultValues={{ descricao: '', desccodplc: '' }}
      campos={({ form, editavel, novo }) => (
        <div className="flex flex-col gap-form-gap">
          <TeclasDoPlc novo={novo} />
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
            <Controller control={form.control} name="codpai" render={({ field }) => (
              <SelectField label="Conta retrocedente" options={plcs} value={field.value != null && field.value !== '' ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : '')} placeholder="Conta raiz" disabled={!editavel} />
            )} />
            <Field label="Código da conta" disabled={!editavel} maxLength={30} error={form.formState.errors.desccodplc?.message as string | undefined} {...form.register('desccodplc')} />
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
            <div className="sm:col-span-3">
              <Controller control={form.control} name="codcontabil" render={({ field }) => (
                <SelectField label="Lançamento contábil" options={contas} value={field.value != null && field.value !== '' ? String(field.value) : undefined}
                  onChange={(v) => field.onChange(v ? Number(v) : '')} placeholder="—" disabled={!editavel} />
              )} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-gp-lg">
            {FLAGS.map(([name, label]) => (
              <Controller key={name} control={form.control} name={name as never} render={({ field }: any) => (
                <CheckboxField label={label} value={(field.value as string | undefined) ?? 'N'} onChange={field.onChange} disabled={!editavel} />
              )} />
            ))}
          </div>
        </div>
      )}
    />
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
