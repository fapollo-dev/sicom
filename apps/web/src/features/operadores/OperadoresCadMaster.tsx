import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { operadorSchema, OPERADOR_TIPO_OPCOES, type CriarOperadorDto } from '@apollo/shared';

/**
 * OPERADORES (uCadUsuarios "Cadastro de usuários") via o pilar <CadMaster> — corte-1 núcleo cadastral.
 * PK DIGITADA (pkGerada={false}); GLOBAL. Campos: nome, login (único), tipo (deriva o grupo no
 * servidor), parceiro/funcionário (lookup FUN='S', fiel a uCadUsuarios.pas:491), desabilitado
 * (bloqueia login), flags PDV, solicitar troca de senha, ativo. Senha, empresas-permitidas, perfis,
 * supervisionados e biometria = cortes seguintes.
 */
export function OperadoresCadMaster() {
  const { data: parceiroOptions = [] } = useResourceOptions(
    'cadastro/parceiros',
    (p: any) => ({ value: String(p.codparceiro ?? p.codigo), label: `${p.codparceiro ?? p.codigo} - ${p.razao ?? ''}` }),
    { campo: 'fun', operador: 'igual', valor: 'S' },
  );

  return (
    <CadMaster<CriarOperadorDto>
      titulo="Operadores"
      resourcePath="cadastro/operadores"
      pk="codoperador"
      pkGerada={false} // código do operador é digitado
      colunasPesquisa={[
        { campo: 'codoperador', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'nome', label: 'Nome', tipo: 'text' },
        { campo: 'login', label: 'Login', tipo: 'text', largura: 160 },
      ]}
      schema={operadorSchema}
      defaultValues={{
        nome: '',
        login: '',
        desabilitado: 'N',
        desabilita_operacoes_basicas: 'N',
        desabilita_desconto_pdv: 'N',
        solicitar_alteracao_senha: 'S',
      }}
      campos={({ form, editavel }) => (
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <Field
            label="&Nome"
            maxLength={30}
            disabled={!editavel}
            error={form.formState.errors.nome?.message as string | undefined}
            {...form.register('nome')}
          />
          <Field
            label="&Login"
            maxLength={50}
            disabled={!editavel}
            error={form.formState.errors.login?.message as string | undefined}
            {...form.register('login')}
          />
          <Controller
            control={form.control}
            name="tipoop"
            render={({ field }) => (
              <SelectField
                label="&Tipo de operador"
                options={OPERADOR_TIPO_OPCOES}
                value={field.value ?? undefined}
                onChange={field.onChange}
                placeholder="Selecione o tipo…"
                error={form.formState.errors.tipoop?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="codparceiro"
            render={({ field }) => (
              <SelectField
                label="&Parceiro (funcionário)"
                options={parceiroOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Opcional…"
              />
            )}
          />
          <div className="sm:col-span-2 grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <Controller
              control={form.control}
              name="desabilitado"
              render={({ field }) => (
                <CheckboxField label="&Desabilitado (bloqueia acesso)" value={field.value ?? 'N'} onChange={field.onChange} disabled={!editavel} />
              )}
            />
            <Controller
              control={form.control}
              name="desabilita_operacoes_basicas"
              render={({ field }) => (
                <CheckboxField label="Desabilita &Operações Básicas (PDV)" value={field.value ?? 'N'} onChange={field.onChange} disabled={!editavel} />
              )}
            />
            <Controller
              control={form.control}
              name="desabilita_desconto_pdv"
              render={({ field }) => (
                <CheckboxField label="Desabilita Desco&nto no PDV" value={field.value ?? 'N'} onChange={field.onChange} disabled={!editavel} />
              )}
            />
            <Controller
              control={form.control}
              name="solicitar_alteracao_senha"
              render={({ field }) => (
                <CheckboxField label="&Solicitar troca de senha no próximo login" value={field.value ?? 'S'} onChange={field.onChange} disabled={!editavel} />
              )}
            />
          </div>
        </div>
      )}
    />
  );
}
