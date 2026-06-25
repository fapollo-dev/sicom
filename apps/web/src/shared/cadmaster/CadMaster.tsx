import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useForm, type FieldValues, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodSchema } from 'zod';
import { PageHeader, AlertModal } from '@apollosg/design-system';
import { FormScope, useShortcutRegistry } from '../keyboard';
import { Button } from '../ui/Button';
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
  viewPk,
  pkGerada = true,
  outros,
  campos,
}: Props<T>) {
  const api = useMemo(() => createResourceApi(resourcePath), [resourcePath]);
  const colunaCodigo = viewPk ?? pk;
  const cad = useCadMaster(api, pk, colunaCodigo);
  const form = useForm<T>({ resolver: zodResolver(schema), defaultValues });
  const [codigo, setCodigo] = useState('');
  const [pesquisaAberta, setPesquisaAberta] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(false);
  // chave natural: no insert o usuário DIGITA o código (que vira a PK)
  const codigoEditavelInsert = !pkGerada && cad.modo === 'insert';

  const carregar = async () => {
    if (!codigo) return;
    await cad.carregarPorCodigo(Number(codigo));
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
    await cad.gravar(dto);
  });
  const onNovo = () => {
    form.reset(defaultValues ?? ({} as T));
    setCodigo(''); // limpa o código (no natural, o usuário vai digitar o novo)
    cad.novo();
  };
  const onEditar = () => cad.editar();
  const onExcluir = () => setConfirmExcluir(true); // abre o AlertModal do DS (≠ confirm() nativo)
  const doExcluir = async () => {
    await cad.excluir();
    form.reset(defaultValues ?? ({} as T));
    setCodigo('');
    setConfirmExcluir(false);
  };
  const onCancelar = () => {
    cad.cancelar();
    sincroniza();
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <PageHeader title={titulo} description="Cadastro — teclado-first (Enter carrega · setas navegam · F6 filtra · Alt+letra)" />
      <div style={{ marginTop: 16 }} />
      <FormScope onSubmit={onGravar}>
        {/* CABEÇALHO: código (editável só no browse; Enter carrega) */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Código</span>
            <input
              value={codigo}
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
              style={{ padding: '6px 8px', border: '1px solid #999', borderRadius: 4, width: 120 }}
            />
          </label>
          {colunasPesquisa && cad.codigoEditavel && (
            <Button label="&Pesquisar" variant="soft" onClick={() => setPesquisaAberta(true)} />
          )}
        </div>

        {pesquisaAberta && colunasPesquisa && (
          <Pesquisa
            resourcePath={resourcePath}
            colunas={colunasPesquisa}
            onFechar={() => setPesquisaAberta(false)}
            onSelecionar={(row) => {
              const id = Number(row[colunaCodigo]);
              setPesquisaAberta(false);
              void cad.carregarPorCodigo(id); // efeito sincroniza form + código
            }}
          />
        )}

        {/* CAMPOS DA TELA (read-only fora de insert/edit) */}
        <fieldset disabled={!cad.editavel} style={{ border: 'none', padding: 0, margin: 0 }}>
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
    <div style={{ display: 'flex', gap: 8, marginTop: 16, position: 'relative' }}>
      <button type="submit" style={{ display: 'none' }} aria-hidden />
      {cad.podeAdicionar && <Button label="&Adicionar" variant="soft" onClick={onNovo} />}
      {cad.podeEditar && <Button label="&Editar" onClick={onEditar} />}
      {cad.podeExcluir && <Button label="E&xcluir" variant="ghost" onClick={onExcluir} />}
      {cad.podeGravar && <Button label="&Gravar" onClick={onGravarSubmit} />}
      <Button label={cad.cancelarLabel === 'Sair' ? '&Sair' : '&Cancelar'} variant="ghost" onClick={onCancelar} />

      {/* "Outros" (Alt+O) — popup de ações extras por-tela (ppmBotaoOutros) */}
      {temOutros && <Button label="&Outros" variant="ghost" onClick={() => setOutrosAberto((v) => !v)} />}
      {temOutros && outrosAberto && (
        <div
          role="menu"
          aria-label="Outros"
          style={{
            position: 'absolute', bottom: '100%', right: 0, marginBottom: 4, zIndex: 40,
            background: '#fff', border: '1px solid #ccc', borderRadius: 6,
            boxShadow: '0 4px 16px rgba(0,0,0,.12)', minWidth: 200, display: 'flex', flexDirection: 'column',
          }}
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
              style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer' }}
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
