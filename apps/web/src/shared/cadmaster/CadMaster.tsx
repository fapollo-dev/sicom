import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useForm, type FieldValues, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodSchema } from 'zod';
import { PageHeader, AlertModal, FormFieldInput } from '@apollosg/design-system';
import { FormScope, useShortcutRegistry } from '../keyboard';
import { Button } from '../ui/Button';
import { useMensagem } from '../mensagem';
import { createResourceApi } from './resourceApi';
import { useCadMaster } from './useCadMaster';
import { Pesquisa, type ColunaPesquisa } from './Pesquisa';

interface CamposCtx<T extends FieldValues> {
  form: UseFormReturn<T>;
  editavel: boolean;
}

interface Props<T extends FieldValues> {
  titulo: string;
  resourcePath: string; // ex.: 'cadastro/marcas'
  pk: string; // ex.: 'idmarca'
  schema: ZodSchema;
  defaultValues?: any;
  /** colunas da Pesquisa (campo na view + rótulo) */
  colunasPesquisa?: ColunaPesquisa[];
  /**
   * Filtro fixo da Pesquisa — para recursos PARAMETRIZADOS (ex.: a tela única de
   * Parceiros que lista só CLI='S' ou FRN='S' conforme o papel). Repassado tal qual
   * para `<Pesquisa>`. Opcional → sem ele a Pesquisa lista o recurso inteiro.
   */
  filtroPesquisa?: { campo: string; operador?: string; valor: string };
  /** coluna na view que contém o código a carregar (default: pk) */
  viewPk?: string;
  /**
   * PK gerada pelo banco (default true). Em CHAVE NATURAL (ex.: NCM), passe false:
   * o campo-código fica editável no insert e seu valor entra no dto como a PK.
   */
  pkGerada?: boolean;
  /** ações do menu "Outros" (btnOutros/ppmBotaoOutros do form-base; Alt+O abre) */
  outros?: AcaoOutros[];
  /** render-prop dos campos da tela (recebe o form e se está editável) */
  campos: (ctx: CamposCtx<T>) => ReactNode;
}

/** uma ação do menu "Outros" (relatório, tela relacionada, rotina). */
export interface AcaoOutros {
  label: string; // pode conter & (mnemônico próprio dentro do menu)
  onClick: () => void;
}

/**
 * Shell do CadMaster — o equivalente React do form-base `TfrmCadMaster`.
 * Qualquer cadastro = título + recurso + campos; herda daqui: máquina de estados
 * (browse/insert/edit), botões padrão com mnemônicos por estado, carregar-por-código
 * (Enter), camada de teclado. Espelha ControlaTela / o rodapé do form-base.
 */
export function CadMaster<T extends FieldValues>({
  titulo,
  resourcePath,
  pk,
  schema,
  defaultValues,
  colunasPesquisa,
  filtroPesquisa,
  viewPk,
  pkGerada = true,
  outros,
  campos,
}: Props<T>) {
  const api = useMemo(() => createResourceApi(resourcePath), [resourcePath]);
  const colunaCodigo = viewPk ?? pk;
  const cad = useCadMaster(api, pk, colunaCodigo);
  const form = useForm<T>({ resolver: zodResolver(schema), defaultValues });
  const mensagem = useMensagem(); // exibição padronizada de erros (ADR-015)
  const [codigo, setCodigo] = useState('');
  const [pesquisaAberta, setPesquisaAberta] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(false);
  // chave natural: no insert o usuário DIGITA o código (que vira a PK)
  const codigoEditavelInsert = !pkGerada && cad.modo === 'insert';

  const carregar = async () => {
    if (!codigo) return;
    try {
      await cad.carregarPorCodigo(Number(codigo));
    } catch (e) {
      mensagem.erro(e);
    }
  };
  // ao carregar/gravar, sincroniza o form com o registro corrente
  const sincroniza = () => form.reset((cad.registro as any) ?? ({} as T));

  // sempre que um registro é carregado (Enter, Pesquisa, navegação por setas, pós-gravação),
  // espelha-o no form e no campo-código — evita o registro defasado pelo closure.
  useEffect(() => {
    if (cad.registro) {
      form.reset(cad.registro as any);
      setCodigo(String(cad.registro[colunaCodigo] ?? cad.registro[pk] ?? ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cad.registro]);

  const onGravar = form.handleSubmit(async (values) => {
    // chave natural no insert: o código digitado entra no dto como a PK
    const dto = codigoEditavelInsert ? { ...values, [pk]: Number(codigo) } : values;
    try {
      await cad.gravar(dto);
    } catch (e) {
      mensagem.erro(e);
    }
  });
  const onNovo = () => {
    form.reset(defaultValues ?? ({} as T));
    setCodigo(''); // limpa o código (no natural, o usuário vai digitar o novo)
    cad.novo();
  };
  const onEditar = () => cad.editar();
  const onExcluir = () => setConfirmExcluir(true); // abre o AlertModal do DS (≠ confirm() nativo)
  const doExcluir = async () => {
    try {
      await cad.excluir();
      form.reset(defaultValues ?? ({} as T));
      setCodigo('');
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setConfirmExcluir(false);
    }
  };
  const onCancelar = () => {
    cad.cancelar();
    sincroniza();
  };

  return (
    <div className="flex flex-col gap-form-gap max-w-3xl">
      <PageHeader title={titulo} description="Cadastro — teclado-first (Enter carrega · setas navegam · F6 filtra · Alt+letra)" />
      <FormScope onSubmit={onGravar}>
        {/* CABEÇALHO: código (editável só no browse; Enter carrega) — FormFieldInput do DS */}
        <div className="flex items-end gap-gp-sm mb-form-gap">
          <div className="w-40">
            <FormFieldInput
              label="Código"
              value={codigo}
              inputMode="numeric"
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                // mapa de teclado do edtCodigo (form-base): Enter carrega, setas navegam
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void carregar();
                } else if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  void cad.anterior();
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  void cad.proximo();
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  void cad.primeiro();
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  void cad.ultimo();
                }
              }}
              disabled={!cad.codigoEditavel && !codigoEditavelInsert}
            />
          </div>
          {colunasPesquisa && cad.codigoEditavel && (
            <Button label="&Pesquisar" variant="soft" onClick={() => setPesquisaAberta(true)} />
          )}
        </div>

        {pesquisaAberta && colunasPesquisa && (
          <Pesquisa
            resourcePath={resourcePath}
            colunas={colunasPesquisa}
            filtroExtra={filtroPesquisa}
            onFechar={() => setPesquisaAberta(false)}
            onSelecionar={(row) => {
              const id = Number(row[colunaCodigo]);
              setPesquisaAberta(false);
              void cad.carregarPorCodigo(id); // efeito sincroniza form + código
            }}
          />
        )}

        {/* CAMPOS DA TELA (read-only fora de insert/edit) */}
        <fieldset disabled={!cad.editavel} className="border-0 p-0 m-0">
          {campos({ form, editavel: cad.editavel })}
        </fieldset>

        {/* RODAPÉ: botões padrão por estado (mnemônicos como no legado) */}
        <Rodape
          cad={cad}
          onNovo={onNovo}
          onEditar={onEditar}
          onExcluir={onExcluir}
          onCancelar={onCancelar}
          outros={outros}
        />
      </FormScope>

      {/* Confirmação de exclusão — AlertModal do DS (substitui o confirm() nativo) */}
      <AlertModal
        open={confirmExcluir}
        onOpenChange={setConfirmExcluir}
        tone="danger"
        title="Confirma a exclusão do registro?"
        description="Esta ação remove o registro corrente."
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        onConfirm={doExcluir}
      />
    </div>
  );
}

function Rodape({ cad, onNovo, onEditar, onExcluir, onCancelar, outros }: any) {
  // dentro do FormScope → useShortcutRegistry disponível (mnemônicos via Button)
  useShortcutRegistry();
  const [outrosAberto, setOutrosAberto] = useState(false);
  const temOutros: boolean = Array.isArray(outros) && outros.length > 0;
  return (
    <div className="relative mt-form-gap flex items-center gap-gp-sm border-t border-border pt-form-gap">
      <button type="submit" className="hidden" aria-hidden />

      {/* esquerda: destrutivas / secundárias */}
      {cad.podeExcluir && <Button label="E&xcluir" variant="ghost" onClick={onExcluir} />}
      {temOutros && <Button label="&Outros" variant="ghost" onClick={() => setOutrosAberto((v) => !v)} />}

      {/* direita: ações primárias por estado (mnemônicos como no form-base) */}
      <div className="ml-auto flex gap-gp-sm">
        <Button label={cad.cancelarLabel === 'Sair' ? '&Sair' : '&Cancelar'} variant="outline" onClick={onCancelar} />
        {cad.podeAdicionar && <Button label="&Adicionar" variant="soft" onClick={onNovo} />}
        {cad.podeEditar && <Button label="&Editar" variant="outline" onClick={onEditar} />}
        {cad.podeGravar && <Button label="&Gravar" variant="filled" onClick={onGravarSubmit} />}
      </div>

      {temOutros && outrosAberto && (
        <div
          role="menu"
          aria-label="Outros"
          className="absolute bottom-full right-0 mb-gp-xs z-40 flex w-56 flex-col rounded-radius-base border border-border bg-bg-surface shadow-sh-md"
        >
          {outros.map((a: { label: string; onClick: () => void }, i: number) => (
            <button
              key={i}
              role="menuitem"
              type="button"
              onClick={() => {
                setOutrosAberto(false);
                a.onClick();
              }}
              className="cursor-pointer border-0 bg-transparent px-pad-md py-gp-xs text-left text-body-sm text-fg-default hover:bg-bg-canvas"
            >
              {a.label.replace('&', '')}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // Gravar dispara o submit do FormScope (Enter/Alt+G → mesma rota de validação)
  function onGravarSubmit() {
    const formEl = document.querySelector('form');
    (formEl as HTMLFormElement | null)?.requestSubmit();
  }
}
