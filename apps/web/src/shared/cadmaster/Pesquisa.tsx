import { useEffect, useMemo, useState } from 'react';
import { Modal, DataTable } from '@apollosg/design-system';
import { createResourceApi } from './resourceApi';

export interface ColunaPesquisa {
  campo: string;
  label: string;
}

// rdgAtivo do form-base: F6 cicla nesta ordem
const SITUACOES = ['ativos', 'inativos', 'todos'] as const;
type Situacao = (typeof SITUACOES)[number];
const SIT_LABEL: Record<Situacao, string> = { ativos: 'Ativos', inativos: 'Inativos', todos: 'Todos' };

interface Props {
  resourcePath: string;
  colunas: ColunaPesquisa[];
  onSelecionar: (row: Record<string, any>) => void;
  onFechar: () => void;
}

/**
 * Pesquisa (frmPesquisa) reconstruída sobre o **DataTable do Apollo DS** dentro de um
 * **Modal do DS** — zero hardcode (ADR-014 / tronco). A busca/filtro/ordenação do DataTable
 * substituem o campo+operador+valor feito à mão; F6 mantém o rdgAtivo (situação); clique na
 * linha seleciona (onRowClick). Ref.: design-system/src/preview/pages/ClientsCRUDPreview.tsx.
 */
export function Pesquisa({ resourcePath, colunas, onSelecionar, onFechar }: Props) {
  const api = useMemo(() => createResourceApi(resourcePath), [resourcePath]);
  const [situacao, setSituacao] = useState<Situacao>('ativos');
  const [rows, setRows] = useState<Record<string, any>[]>([]);

  // carrega a lista pela view (GET_*), refazendo quando a situação muda
  useEffect(() => {
    let alive = true;
    void api.listar({ situacao }).then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  }, [api, situacao]);

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
        sortable: true,
        enableColumnFilter: true,
        filterType: 'text' as const,
        isPrimary: i === 0,
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
