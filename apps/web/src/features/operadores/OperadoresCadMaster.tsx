import { lazy, Suspense, useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { CadMasterDet } from '../../shared/cadmaster/CadMasterDet';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { NumberField } from '../../shared/ui/NumberField';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { LookupField } from '../../shared/ui/LookupField';
import { Tabs } from '../../shared/ui/Tabs';
import { ListaPesquisada } from '../../shared/pesquisa/ListaPesquisada';
import { Modal } from '../../shared/ui/Modal';
import { useShortcut } from '../../shared/keyboard';
import { useMensagem } from '../../shared/mensagem';
import { operadorSchema, OPERADOR_TIPO_OPCOES, type CriarOperadorDto } from '@apollo/shared';

type Item = Record<string, unknown>;
// o cadastro de perfil abre por cima pelo F2 (e o de perfil abre este pelo F2 dele): carregado sob demanda, sem ciclo de import
const PerfilCadMaster = lazy(async () => ({ default: (await import('../perfil/PerfilCadMaster')).PerfilCadMaster }));

/**
 * as abas do cadastro de usuários que o Apollo não tinha (uCadUsuarios.dfm:751-1040, :2213-2340): "Perfil operador" (perfis de ACESSO —
 * contam no acesso, a produção está em CONTROLE_PERMISSOES = Ambos), "Perfil de compras" e, só no SUPERVISOR, "Operadores supervisionados".
 * Tudo vai no Gravar do operador (o servidor confere o tipo do perfil e do supervisionado).
 */
function AbasDoOperador({ form, editavel, carregar, aoFechar }: {
  form: UseFormReturn<CriarOperadorDto>; editavel: boolean; carregar?: (id: number) => Promise<void>; aoFechar?: () => void;
}) {
  const mensagem = useMensagem();
  const [aba, setAba] = useState('perfil');
  const [perfilAberto, setPerfilAberto] = useState(false);
  const tipo = form.watch('tipoop');
  const nome = form.watch('nome');
  const lista = (campo: 'perfis' | 'perfis_compra' | 'supervisionados') => ((form.watch(campo) as Item[] | undefined) ?? []);
  const mudar = (campo: 'perfis' | 'perfis_compra' | 'supervisionados') => (itens: Item[]) =>
    form.setValue(campo, itens as never, { shouldDirty: true });
  // "O operador X já possui vinculo com o perfil Y ." (uCadUsuarios.pas:246-251)
  const jaTem = (itens: Item[]) =>
    window.alert(itens.map((i) => `O operador ${nome ?? ''} já possui vinculo com o perfil ${String(i.perfil ?? i.codperfil)} .`).join('\n'));
  const abas = [
    { id: 'perfil', label: 'Perfil operador' },
    { id: 'compra', label: 'Perfil de compras' },
    ...(tipo === 'SUP' ? [{ id: 'sup', label: 'Operadores supervisionados' }] : []),
  ];
  const ativa = abas.some((a) => a.id === aba) ? aba : 'perfil';
  // F2 (FormKeyDown, uCadUsuarios.pas:687-726): o cadastro de perfil por cima, no tipo da aba (Perfil de compras → COMPRA; senão ACESSO);
  // ao voltar, recarrega o operador (edtCodigoExit). Aberto pelo F2 do cadastro de perfil, fecha
  useShortcut('f2', () => { if (aoFechar) aoFechar(); else setPerfilAberto(true); }, { when: !perfilAberto });
  const voltar = () => {
    setPerfilAberto(false);
    const cod = Number(form.getValues('codoperador' as never));
    if (cod && carregar) void carregar(cod).catch((e) => mensagem.erro(e));
  };
  const perfil = (l: Item) => ({ codperfil: Number(l.codigo ?? l.codperfil), perfil: l.perfil ?? null });
  const colsPerfil = [{ campo: 'codperfil', rotulo: 'Código', largura: 110 }, { campo: 'perfil', rotulo: 'Perfil' }];
  return (
    <div className="sm:col-span-2 flex flex-col gap-form-gap">
      <Tabs tabs={abas} active={ativa} onChange={setAba} />
      {ativa === 'perfil' && (
        <ListaPesquisada rotulo="Perfis do operador" itens={lista('perfis')} onChange={mudar('perfis')} chave="codperfil" colunas={colsPerfil}
          recurso="lookup/perfis" fixos={{ ativo: 'S', tipo: 'ACESSO' }} deLinha={perfil} editavel={editavel} aoRepetir={jaTem} confirmarExclusao />
      )}
      {ativa === 'compra' && (
        <ListaPesquisada rotulo="Perfis de compras" itens={lista('perfis_compra')} onChange={mudar('perfis_compra')} chave="codperfil" colunas={colsPerfil}
          recurso="lookup/perfis" fixos={{ ativo: 'S', tipo: 'COMPRA' }} deLinha={perfil} editavel={editavel} aoRepetir={jaTem} confirmarExclusao />
      )}
      {ativa === 'sup' && (
        // a GET_OPERADORES com TIPO_SIGLA = 'OPE' (uCadUsuarios.pas:281)
        <ListaPesquisada rotulo="Operadores supervisionados" itens={lista('supervisionados')} onChange={mudar('supervisionados')} chave="codoperador"
          colunas={[{ campo: 'codoperador', rotulo: 'Código', largura: 110 }, { campo: 'nome', rotulo: 'Nome' }]}
          recurso="lookup/operadores" fixos={{ tipo_sigla: 'OPE' }}
          deLinha={(l) => ({ codoperador: Number(l.codigo ?? l.codoperador), nome: l.nome ?? null })} editavel={editavel} />
      )}
      {perfilAberto && (
        <Modal open onClose={voltar} size="lg" title="Cadastro de perfil de operador" className="w-[96vw] max-w-[1400px] max-h-[92vh] overflow-y-auto">
          <Suspense fallback={<p className="p-pad-md text-body-sm text-fg-muted">Abrindo o cadastro…</p>}>
            <PerfilCadMaster tipoInicial={ativa === 'compra' ? 'COMPRA' : 'ACESSO'} aoFechar={voltar} />
          </Suspense>
        </Modal>
      )}
    </div>
  );
}

/**
 * OPERADORES (uCadUsuarios "Cadastro de usuários") via o pilar <CadMasterDet> — corte-2.
 * PK DIGITADA (pkGerada={false}); GLOBAL. Header: nome, login (único), tipo (deriva o grupo no
 * servidor), parceiro/funcionário (lookup FUN='S', uCadUsuarios.pas:491), supervisor (lookup operadores,
 * uCadUsuarios.pas), flags. Detalhe: EMPRESAS-PERMITIDAS (ponte 1:N; ≥1 obrigatória — uCadUsuarios.pas:444).
 * A senha do cadastro vai ao hash do servidor (troca no 1º acesso). As abas de perfis e supervisionados: `AbasDoOperador`.
 * F2 abre o cadastro de perfil por cima (no tipo da aba). Fora: a biometria (leitor NBioBSP).
 */
export function OperadoresCadMaster({ aoFechar }: { aoFechar?: () => void } = {}) {
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
        { campo: 'codigo', label: 'Código', tipo: 'text', largura: 110 },
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
        perfis: [],
        perfis_compra: [],
        supervisionados: [],
      }}
      detalhe={{
        chave: 'empresas',
        titulo: 'Empresas permitidas (ao menos uma)',
        novoItem: () => ({ codempresa: undefined }),
        // o BitBtn1 do legado (uCadUsuarios.pas:168-189): a Pesquisa da GET_EMPRESAS em multisseleção; a empresa que já está não repete
        pesquisa: { recurso: 'cadastro/empresas', item: (l) => ({ codempresa: Number(l.codigo) }), chave: (i) => i?.codempresa },
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
      campos={({ form, editavel, carregar }) => (
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
                onChange={(v) => {
                  // quem deixa de ser supervisor perde os supervisionados — com confirmação; "não" fica no Supervisor (cbbTipoExit,
                  // uCadUsuarios.pas:528-549)
                  const sup = (form.getValues('supervisionados') as Item[] | undefined) ?? [];
                  if (field.value === 'SUP' && v !== 'SUP' && sup.length) {
                    if (!window.confirm('O vínculo de supervisor com outros operadores será removido.\nDeseja continuar?')) return;
                    form.setValue('supervisionados', [], { shouldDirty: true });
                  }
                  // o supervisor do próprio operador só existe no tipo Operador (ProcessaRegrasSupervisor, :745-755)
                  if (v !== 'OPE') form.setValue('idsupervisor', undefined, { shouldDirty: true });
                  field.onChange(v);
                }}
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
          {/* uCadUsuarios.pas:497-501 — GET_OPERADORES, CODIGO/NOME, DESABILITADO='N' AND TIPO_SIGLA='SUP' (TIPO_SIGLA = O.TIPOOP na view);
              só habilita no tipo Operador (ProcessaRegrasSupervisor, :745-755) */}
          <Controller
            control={form.control}
            name="idsupervisor"
            render={({ field }) => (
              <LookupField
                label="Supervisor"
                recurso="lookup/operadores"
                campoCodigo="codoperador"
                descricao="nome"
                fixos={{ tipo_sigla: 'SUP', desabilitado: 'N' }}
                value={field.value}
                onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)}
                disabled={!editavel || form.watch('tipoop') !== 'OPE'}
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
          <AbasDoOperador form={form} editavel={editavel} carregar={carregar} aoFechar={aoFechar} />
        </div>
      )}
    />
  );
}
