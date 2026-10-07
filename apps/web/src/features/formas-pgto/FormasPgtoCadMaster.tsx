import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { LookupField } from '../../shared/ui/LookupField';
import { formaPgtoSchema, FORMA_PGTO_DESTINO_OPCOES, type CriarFormaPgtoDto } from '@apollo/shared';

/**
 * FORMAS DE PAGAMENTO (uCadFormaPgto) via <CadMaster> — corte-1. empresaScoped (IDEMPRESA), PK IDPGTO
 * por sequence. Núcleo (modalidade/atalho/destino) + os 3 vínculos de integração (conta corrente/cofre
 * PLC/conta contábil, lookups) + flags PDV. Regra DESTINO='QUE'≠PDV validada no schema (superRefine).
 * TEF/taxas/parcelamento/condições = corte-2.
 */
export function FormasPgtoCadMaster() {
  const { data: contaOptions = [] } = useResourceOptions(
    'cadastro/contas-bancarias',
    (c: any) => ({ value: String(c.codconta), label: `${c.codconta} - ${c.titular ?? c.banco ?? ''}` }),
  );

  return (
    <CadMaster<CriarFormaPgtoDto>
      titulo="Formas de Pagamento"
      resourcePath="cadastro/formas-pgto"
      pk="idpgto"
      log={{ form: 'FRMCADFORMAPGTO', chave: 'IDPGTO' }}
      colunasPesquisa={[
        { campo: 'idpgto', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'modalidade', label: 'Modalidade', tipo: 'text' },
        { campo: 'atalho', label: 'Atalho', tipo: 'text', largura: 100 },
        { campo: 'destino', label: 'Destino', tipo: 'text', largura: 120 },
      ]}
      schema={formaPgtoSchema}
      defaultValues={{ recebe_pdv: 'S', permite_sangria_pdv: 'N', inativo: 'N' }}
      campos={({ form, editavel }) => (
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <Field
            label="Modalidade"
            maxLength={30}
            disabled={!editavel}
            error={form.formState.errors.modalidade?.message as string | undefined}
            {...form.register('modalidade')}
          />
          <Field
            label="&Atalho (tecla PDV)"
            maxLength={20}
            disabled={!editavel}
            error={form.formState.errors.atalho?.message as string | undefined}
            {...form.register('atalho')}
          />
          <Controller
            control={form.control}
            name="destino"
            render={({ field }) => (
              <SelectField
                label="&Destino (roteamento)"
                options={FORMA_PGTO_DESTINO_OPCOES}
                value={field.value ?? undefined}
                onChange={field.onChange}
                placeholder="Selecione o destino…"
                error={form.formState.errors.destino?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="codcontacorrente"
            render={({ field }) => (
              <SelectField
                label="&Conta corrente (tesouraria)"
                options={contaOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Opcional…"
              />
            )}
          />
          {/* uCadFormaPgto.pas:239-241 — GET_PLC; o filtro do legado (comprimento da máscara) não é igualdade: fica no servidor */}
          <Controller
            control={form.control}
            name="plccofre"
            render={({ field }) => (
              <LookupField
                label="Centro de custo / co&fre"
                recurso="lookup/plc"
                parametros={{ lancavel: 'S' }}
                campoCodigo="codplc"
                descricao={(l) => `${l.desccodplc ?? l.codplc} - ${l.descricao ?? ''}`}
                value={field.value as number | undefined}
                onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)}
                disabled={!editavel}
              />
            )}
          />
          {/* uCadFormaPgto.pas:291 (EdtPlanoContas → CODPLANOCONTAS) — GET_PLANO_CONTAS (CLASSE='ANALITICA') AND (TIPO='EMPRESA') */}
          <Controller
            control={form.control}
            name="codplanocontas"
            render={({ field }) => (
              <LookupField
                label="Conta contábil (débito)"
                recurso="lookup/plano-contas"
                campoCodigo="codplanocontas"
                descricao="descricao_completa"
                fixos={{ classe: 'A', tipo: 'E' }}
                value={field.value as number | undefined}
                onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)}
                disabled={!editavel}
              />
            )}
          />
          <div className="sm:col-span-2 grid grid-cols-1 gap-form-gap sm:grid-cols-3">
            <Controller
              control={form.control}
              name="recebe_pdv"
              render={({ field }) => (
                <CheckboxField label="Recebe no PDV" value={field.value ?? 'S'} onChange={field.onChange} disabled={!editavel} />
              )}
            />
            <Controller
              control={form.control}
              name="permite_sangria_pdv"
              render={({ field }) => (
                <CheckboxField label="Permite &sangria PDV" value={field.value ?? 'N'} onChange={field.onChange} disabled={!editavel} />
              )}
            />
            <Controller
              control={form.control}
              name="inativo"
              render={({ field }) => (
                <CheckboxField label="&Inativo" value={field.value ?? 'N'} onChange={field.onChange} disabled={!editavel} />
              )}
            />
          </div>
        </div>
      )}
    />
  );
}
