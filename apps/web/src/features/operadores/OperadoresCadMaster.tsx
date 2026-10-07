import { Controller } from 'react-hook-form';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { CadMasterDet } from '../../shared/cadmaster/CadMasterDet';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { NumberField } from '../../shared/ui/NumberField';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { LookupField } from '../../shared/ui/LookupField';
import { operadorSchema, OPERADOR_TIPO_OPCOES, type CriarOperadorDto } from '@apollo/shared';

/**
 * OPERADORES (uCadUsuarios "Cadastro de usuários") via o pilar <CadMasterDet> — corte-2.
 * PK DIGITADA (pkGerada={false}); GLOBAL. Header: nome, login (único), tipo (deriva o grupo no
 * servidor), parceiro/funcionário (lookup FUN='S', uCadUsuarios.pas:491), supervisor (lookup operadores,
 * uCadUsuarios.pas), flags. Detalhe: EMPRESAS-PERMITIDAS (ponte 1:N; ≥1 obrigatória — uCadUsuarios.pas:444).
 * A senha do cadastro vai ao hash do servidor (troca no 1º acesso). Perfis/RBAC granular e biometria = cortes seguintes.
 */
export function OperadoresCadMaster() {
  // permissões de controle da tela — docs/05-migration-engineering/permissoes-de-controle.md
  const { tem: pode } = useOpcoesDoForm('FRMCADUSUARIOS');
  const { data: empresaOptions = [] } = useResourceOptions(
    'cadastro/empresas',
    (e: any) => ({ value: String(e.idempresa ?? e.codigo), label: `${e.idempresa ?? e.codigo} - ${e.razao_social ?? e.fantasia ?? ''}` }),
  );

  return (
    <CadMasterDet<CriarOperadorDto>
      titulo="Operadores"
      resourcePath="cadastro/operadores"
      pk="codoperador"
      log={{ form: 'FRMCADUSUARIOS', chave: 'CODOPERADOR' }}
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
        menu: 2, // o NewRecord do legado (uRdmCadUsuarios.pas:213)
        ativo: 'S',
        bloquearsuperliberarprop: 'N',
        empresas: [],
      }}
      detalhe={{
        chave: 'empresas',
        titulo: 'Empresas permitidas (ao menos uma)',
        novoItem: () => ({ codempresa: undefined }),
        itemCampos: ({ form, index }) => (
          <Controller
            control={form.control}
            name={`empresas.${index}.codempresa` as const}
            render={({ field }) => (
              <SelectField
                label="Empresa"
                options={empresaOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Selecione a empresa…"
              />
            )}
          />
        ),
      }}
      campos={({ form, editavel }) => (
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <Field
            label="Nome"
            maxLength={30}
            disabled={!editavel}
            error={form.formState.errors.nome?.message as string | undefined}
            {...form.register('nome')}
          />
          <Field
            label="Login"
            maxLength={50}
            disabled={!editavel}
            error={form.formState.errors.login?.message as string | undefined}
            {...form.register('login')}
          />
          {/* a senha (uCadUsuarios.pas:423-432): obrigatória na inclusão; na alteração, vazia mantém a atual. O usuário troca no
              primeiro acesso. */}
          <Field
            label="Senha"
            type="password"
            autoComplete="new-password"
            maxLength={50}
            disabled={!editavel || !pode('EDTSENHARETAGUARDA')}
            error={form.formState.errors.senha?.message as string | undefined}
            {...form.register('senha')}
          />
          <Field
            label="Con&firmar senha"
            type="password"
            autoComplete="new-password"
            maxLength={50}
            disabled={!editavel || !pode('EDTSENHARETAGUARDA')}
            error={form.formState.errors.confirmacaoSenha?.message as string | undefined}
            {...form.register('confirmacaoSenha')}
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
          {/* uCadUsuarios.pas:491-493 — GET_PARCEIROS, CODIGO/RAZAO, FUN='S' */}
          <Controller
            control={form.control}
            name="codparceiro"
            render={({ field }) => (
              <LookupField
                label="&Parceiro (funcionário)"
                recurso="lookup/parceiros"
                campoCodigo="codparceiro"
                descricao="razao"
                fixos={{ fun: 'S' }}
                value={field.value}
                onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)}
                disabled={!editavel}
              />
            )}
          />
          {/* uCadUsuarios.pas:497-501 — GET_OPERADORES, CODIGO/NOME, DESABILITADO='N' AND TIPO_SIGLA='SUP' (TIPO_SIGLA = O.TIPOOP na view) */}
          <Controller
            control={form.control}
            name="idsupervisor"
            render={({ field }) => (
              <LookupField
                label="Supervisor"
                recurso="lookup/operadores"
                campoCodigo="codoperador"
                descricao="nome"
                fixos={{ tipoop: 'SUP', desabilitado: 'N' }}
                value={field.value}
                onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)}
                disabled={!editavel}
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
                <CheckboxField label="Desabilita Desconto no PDV" value={field.value ?? 'N'} onChange={field.onChange} disabled={!editavel} />
              )}
            />
            <Controller
              control={form.control}
              name="solicitar_alteracao_senha"
              render={({ field }) => (
                <CheckboxField label="&Solicitar troca de senha no próximo login" value={field.value ?? 'S'} onChange={field.onChange} disabled={!editavel} />
              )}
            />
            <Controller
              control={form.control}
              name="ativo"
              render={({ field }) => (
                <CheckboxField label="Ativo" value={field.value ?? 'S'} onChange={field.onChange} disabled={!editavel} />
              )}
            />
            <Controller
              control={form.control}
              name="bloquearsuperliberarprop"
              render={({ field }) => (
                <CheckboxField label="Bloquear o supervisor de liberar as próprias operações" value={field.value ?? 'N'} onChange={field.onChange} disabled={!editavel} />
              )}
            />
          </div>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <Controller
              control={form.control}
              name="menu"
              render={({ field }) => (
                <SelectField label="Menu" options={[{ value: '1', label: 'Padrão' }, { value: '2', label: 'Personalizado' }]}
                  value={field.value != null ? String(field.value) : undefined} onChange={(v) => field.onChange(v ? Number(v) : undefined)} disabled={!editavel} />
              )}
            />
            <Controller
              control={form.control}
              name="codigoauxiliar"
              render={({ field }) => (
                <NumberField label="Código auxiliar" value={field.value as number | undefined} onChange={field.onChange} decimais={0} min={0} disabled={!editavel} />
              )}
            />
          </div>
        </div>
      )}
    />
  );
}
