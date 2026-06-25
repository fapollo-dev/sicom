import { useEffect, useMemo, useState } from 'react';
import { Modal, DataTable } from '@apollosg/design-system';
import { createResourceApi } from './resourceApi';

export interface ColunaPesquisa {
  campo: string;
  label: string;
  /** tipo de coluna do DataTable (render+alinhamento+filtro corretos). Default 'text'. */
  tipo?: 'text' | 'number' | 'date' | 'currency' | 'status' | 'badge' | 'email' | 'phone';
  /** largura fixa (px). Sem isso, o autoFit do DataTable distribui. */
  largura?: number;
  /** override do tipo de filtro (default derivado do `tipo`). */
  filtro?: 'text' | 'number' | 'date' | 'select' | 'multiSelect' | 'boolean';
}

/** filtro default por tipo de coluna (espelha o registry do DataTable). */
const FILTRO_POR_TIPO: Record<string, 'text' | 'number' | 'date'> = {
  number: 'number',
  currency: 'number',
  date: 'date',
};

// rdgAtivo do form-base: F6 cicla nesta ordem
const SITUACOES = ['ativos', 'inativos', 'todos'] as const;
type Situacao = (typeof SITUACOES)[number];
const SIT_LABEL: Record<Situacao, string> = { ativos: 'Ativos', inativos: 'Inativos', todos: 'Todos' };

interface Props {
  resourcePath: string;
  colunas: ColunaPesquisa[];
  onSelecionar: (row: Record<string, any>) => void;
  onFechar: () => void;
  /**
   * Filtro fixo aplicado à listagem (espelha um recurso PARAMETRIZADO — ex.: a tela
   * unificada de Parceiros lista só CLI='S' ou FRN='S' conforme o papel). É somado ao
   * `situacao` na query (campo=<col>&operador=igual&valor=S). Opcional → sem ele a
   * Pesquisa se comporta exatamente como antes.
   */
  filtroExtra?: { campo: string; operador?: string; valor: string };
}

/**
 * Pesquisa (frmPesquisa) reconstruída sobre o **DataTable do Apollo DS** dentro de um
 * **Modal do DS** — zero hardcode (ADR-014 / tronco). A busca/filtro/ordenação do DataTable
 * substituem o campo+operador+valor feito à mão; F6 mantém o rdgAtivo (situação); clique na
 * linha seleciona (onRowClick). Ref.: design-system/src/preview/pages/ClientsCRUDPreview.tsx.
 */
export function Pesquisa({ resourcePath, colunas, onSelecionar, onFechar, filtroExtra }: Props) {
  const api = useMemo(() => createResourceApi(resourcePath), [resourcePath]);
  const [situacao, setSituacao] = useState<Situacao>('ativos');
  const [rows, setRows] = useState<Record<string, any>[]>([]);

  // carrega a lista pela view (GET_*), refazendo quando a situação muda. O `filtroExtra`
  // (papel da tela parametrizada) entra como campo/operador/valor na mesma query.
  const campo = filtroExtra?.campo;
  const valor = filtroExtra?.valor;
  const operador = filtroExtra?.operador ?? 'igual';
  useEffect(() => {
    let alive = true;
    const params = campo
      ? { situacao, campo, operador, valor }
      : { situacao };
    void api.listar(params).then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  }, [api, situacao, campo, operador, valor]);

  // F6 cicla a situação (ativos→inativos→todos) enquanto a Pesquisa está aberta
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F6') {
        e.preventDefault();
        setSituacao((s) => SITUACOES[(SITUACOES.indexOf(s) + 1) % SITUACOES.length]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const colCodigo = colunas[0]?.campo ?? 'id';
  const columns = useMemo(
    () =>
      colunas.map((c, i) => ({
        field: c.campo,
        headerName: c.label,
        type: c.tipo ?? 'text',
        width: c.largura,
        sortable: true,
        enableColumnFilter: true,
        filterType: c.filtro ?? FILTRO_POR_TIPO[c.tipo ?? 'text'] ?? 'text',
        // a 2ª coluna (descrição) é o "título" no card/mobile; o código fica estreito
        isPrimary: i === 1,
      })),
    [colunas],
  );

  return (
    <Modal
      open
      onClose={onFechar}
      size="lg"
      title="Pesquisar"
      description={`Situação: ${SIT_LABEL[situacao]} · F6 alterna · clique seleciona · Esc fecha`}
    >
      <DataTable
        rows={rows}
        columns={columns as any}
        getRowId={(r: any) => r[colCodigo]}
        toolbar={{ enableSearch: true, enableFilters: true }}
        paginationConfig={{ enabled: true, initialPageSize: 10 }}
        cardBreakpoint={false}
        onRowClick={(row: any) => onSelecionar(row)}
      />
    </Modal>
  );
}
