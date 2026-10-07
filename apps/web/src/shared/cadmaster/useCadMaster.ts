import { useCallback, useState } from 'react';
import type { ResourceApi } from './resourceApi';
import { useConfirmarSaida } from '../navegacao/useConfirmarSaida';

/** Estados do form-base (TfrmCadMaster): navegar / inserir / editar. */
export type ModoCadMaster = 'browse' | 'insert' | 'edit';

export interface CadMaster<T> {
  modo: ModoCadMaster;
  registro: T | null;
  carregando: boolean;
  // derivados (espelham ControlaTela: o que habilita cada botão / o label do Cancelar)
  editavel: boolean; // campos editáveis? (insert/edit)
  codigoEditavel: boolean; // campo "código" editável? (só no browse, p/ carregar)
  podeAdicionar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
  podeGravar: boolean;
  cancelarLabel: 'Sair' | 'Cancelar';
  // ações
  carregarPorCodigo(id: number): Promise<void>;
  novo(): void;
  editar(): void;
  gravar(values: unknown): Promise<void>;
  excluir(): Promise<void>;
  cancelar(): void;
  // navegação de registro (DBNavigator sobre o cdsNavegation) — só no browse
  /** a lista navegável passa a ser o resultado desta Pesquisa (sem fonte: as setas param) */
  definirNavegacao(fonte?: () => Promise<number[]>): void;
  primeiro(): Promise<void>;
  anterior(): Promise<void>;
  proximo(): Promise<void>;
  ultimo(): Promise<void>;
}

/**
 * Máquina de estados do CadMaster, fiel ao `ControlaTela` do legado:
 *  - browse: campos read-only, código editável (Enter carrega), botão "Sair";
 *  - insert/edit: campos editáveis, código read-only, botão "Cancelar".
 * Botões habilitados conforme o estado e se há registro carregado.
 */
export function useCadMaster<T extends Record<string, any>>(
  api: ResourceApi<T>,
  pk: string,
  /** coluna de código na view de navegação (default: pk); o valor casa com a PK */
  colunaCodigo: string = pk,
): CadMaster<T> {
  const [modo, setModo] = useState<ModoCadMaster>('browse');
  // o FormCloseQuery do uCadMaster: registro em inclusão ou edição, sair pergunta "Deseja sair sem salvar as alterações?"
  useConfirmarSaida(modo !== 'browse', 'Deseja sair sem salvar as alterações?');
  const [registro, setRegistro] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(false);
  // cdsNavegation: o RESULTADO DA ÚLTIMA PESQUISA, na ordem da grade (uCadMaster.pas:547 — o TfrmPesquisa recebe o cdsNavegation).
  // Antes de pesquisar não há lista e as setas não andam (uCadMaster.pas:870-883). Os códigos vêm sob demanda, na 1ª seta.
  const [fonteNav, setFonteNav] = useState<(() => Promise<number[]>) | null>(null);
  const [navList, setNavList] = useState<number[]>([]);
  const definirNavegacao = useCallback((fonte?: () => Promise<number[]>) => {
    setFonteNav(() => fonte ?? null);
    setNavList([]);
  }, []);

  const carregarPorCodigo = useCallback(
    async (id: number) => {
      setCarregando(true);
      try {
        const r = await api.ler(id);
        setRegistro(r ?? null);
        setModo('browse');
      } finally {
        setCarregando(false);
      }
    },
    [api],
  );

  const novo = useCallback(() => {
    setRegistro(null);
    setModo('insert');
  }, []);

  const editar = useCallback(() => {
    setModo((m) => (m === 'browse' && registro ? 'edit' : m));
  }, [registro]);

  const gravar = useCallback(
    async (values: unknown) => {
      setCarregando(true);
      try {
        const salvo =
          modo === 'insert'
            ? await api.criar(values)
            : await api.atualizar(Number(registro![pk]), values);
        setRegistro(salvo ?? null);
        setModo('browse');
        setNavList([]); // o conjunto navegável mudou (insert/edit) → recarrega sob demanda
      } finally {
        setCarregando(false);
      }
    },
    [api, modo, registro, pk],
  );

  const excluir = useCallback(async () => {
    if (!registro) return;
    setCarregando(true);
    try {
      await api.excluir(Number(registro[pk]));
      setRegistro(null);
      setModo('browse');
      setNavList([]); // registro removido → invalida a lista navegável
    } finally {
      setCarregando(false);
    }
  }, [api, registro, pk]);

  const cancelar = useCallback(() => setModo('browse'), []);

  // garante o cdsNavegation carregado (os códigos da última Pesquisa; refeitos depois de gravar/excluir)
  const garantirNav = useCallback(async (): Promise<number[]> => {
    if (navList.length) return navList;
    if (!fonteNav) return [];
    const ids = await fonteNav();
    setNavList(ids);
    return ids;
  }, [fonteNav, navList]);

  // navega para o alvo calculado a partir do índice do registro corrente
  const navegar = useCallback(
    async (alvo: (ids: number[], i: number) => number) => {
      if (modo !== 'browse') return; // setas só navegam no browse
      const ids = await garantirNav();
      if (!ids.length) return;
      const atual = registro ? Number(registro[pk]) : NaN;
      const i = ids.indexOf(atual);
      const destino = ids[alvo(ids, i)];
      if (destino != null) await carregarPorCodigo(destino);
    },
    [modo, garantirNav, registro, pk, carregarPorCodigo],
  );

  const primeiro = useCallback(() => navegar(() => 0), [navegar]);
  const ultimo = useCallback(() => navegar((ids) => ids.length - 1), [navegar]);
  const proximo = useCallback(
    () => navegar((ids, i) => (i < 0 ? 0 : Math.min(i + 1, ids.length - 1))),
    [navegar],
  );
  const anterior = useCallback(
    () => navegar((ids, i) => (i < 0 ? 0 : Math.max(i - 1, 0))),
    [navegar],
  );

  return {
    modo,
    registro,
    carregando,
    editavel: modo !== 'browse',
    codigoEditavel: modo === 'browse',
    podeAdicionar: modo === 'browse',
    podeEditar: modo === 'browse' && registro != null,
    podeExcluir: modo === 'browse' && registro != null,
    podeGravar: modo !== 'browse',
    cancelarLabel: modo === 'browse' ? 'Sair' : 'Cancelar',
    carregarPorCodigo,
    novo,
    editar,
    gravar,
    excluir,
    cancelar,
    definirNavegacao,
    primeiro,
    anterior,
    proximo,
    ultimo,
  };
}
