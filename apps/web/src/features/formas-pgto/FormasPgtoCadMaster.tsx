import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
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
  const { data: plcOptions = [] } = useResourceOptions(
    'cadastro/plc',
    (p: any) => ({ value: String(p.codplc ?? p.codigo), label: `${p.codplc ?? p.codigo} - ${p.descricao ?? ''}` }),
  );
  const { data: contaContabilOptions = [] } = useResourceOptions(
    'cadastro/plano-contas',
    (p: any) => ({ value: String(p.codplanocontas), label: `${p.codiexpandido ?? p.codplanocontas} - ${p.descricao ?? ''}` }),
    { campo: 'classe', operador: 'igual', valor: 'A' }, // só analíticas recebem lançamento
  );

  return (
    <CadMaster<CriarFormaPgtoDto>
      titulo="Formas de Pagamento"
      resourcePath="cadastro/formas-pgto"
      pk="idpgto"
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
            label="&Modalidade"
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
          <Controller
            control={form.control}
            name="plccofre"
            render={({ field }) => (
              <SelectField
                label="Centro de custo / co&fre"
                options={plcOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Opcional…"
              />
            )}
          />
          <Controller
            control={form.control}
            name="codplanocontas"
            render={({ field }) => (
              <SelectField
                label="Conta contá&bil (débito)"
                options={contaContabilOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Opcional…"
              />
            )}
          />
          <div className="sm:col-span-2 grid grid-cols-1 gap-form-gap sm:grid-cols-3">
            <Controller
              control={form.control}
              name="recebe_pdv"
              render={({ field }) => (
                <CheckboxField label="&Recebe no PDV" value={field.value ?? 'S'} onChange={field.onChange} disabled={!editavel} />
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
