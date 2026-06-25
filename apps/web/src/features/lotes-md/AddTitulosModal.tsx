import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  DataTable,
  type DataTableColumnDef,
  type GridSelectionState,
} from '@apollosg/design-system';
import { useMensagem } from '../../shared/mensagem';
import { listAreceber, type AreceberRow } from './lotesCobrancaApi';

interface Props {
  /** codlotecob corrente — passado só ao EDITAR (remove os títulos já no lote). */
  excluirDoLote?: number;
  /** títulos já escolhidos (mesmo não gravados) — para dedupe visual no append. */
  jaSelecionados: number[];
  onFechar: () => void;
  onConfirmar: (rows: AreceberRow[]) => void;
}

/** Estado inicial de seleção do DataTable (nenhuma linha). */
const SEM_SELECAO: GridSelectionState = { type: 'include', ids: new Set() };

/**
 * Picker de títulos a RECEBER (btnAddIten / frmPesquisa 'GET_ARECEBER' do legado),
 * reconstruído sobre o **Modal + DataTable do Apollo DS** — MULTI-seleção (checkbox),
 * busca/filtro/ordenação herdados do DataTable. Confirmar devolve as linhas marcadas
 * (o pai faz o append em `itens` + dedupe por `codrcb`). Zero hardcode (ADR-014).
 */
export function AddTitulosModal({ excluirDoLote, jaSelecionados, onFechar, onConfirmar }: Props) {
  const mensagem = useMensagem();
  const [rows, setRows] = useState<AreceberRow[]>([]);
  const [selecao, setSelecao] = useState<GridSelectionState>(SEM_SELECAO);

  // carrega os títulos disponíveis (consiliado='S' como no legado)
  useEffect(() => {
    let alive = true;
    listAreceber({ excluirDoLote, consiliado: 'S' })
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch((e) => {
        if (alive) mensagem.erro(e);
      });
    return () => {
      alive = false;
    };
  }, [excluirDoLote, mensagem]);

  const columns = useMemo<DataTableColumnDef<AreceberRow>[]>(
    () => [
      { field: 'codrcb', headerName: 'Código', type: 'number', width: 100 },
      { field: 'duplicata', headerName: 'Duplicata', type: 'text', width: 130 },
      { field: 'razao', headerName: 'Cliente', type: 'text', isPrimary: true },
      { field: 'dtvenc', headerName: 'Vencimento', type: 'date', width: 130 },
      { field: 'valor', headerName: 'Valor', type: 'currency', width: 130 },
      { field: 'juros', headerName: 'Juros', type: 'currency', width: 120 },
      { field: 'total', headerName: 'Total', type: 'currency', width: 130 },
    ],
    [],
  );

  // resolve as linhas marcadas a partir do GridSelectionState (modo include)
  const confirmar = () => {
    const ids = selecao.ids;
    const jaSet = new Set(jaSelecionados);
    const escolhidas = rows.filter((r) => ids.has(r.codrcb) && !jaSet.has(r.codrcb));
    onConfirmar(escolhidas);
  };

  const total = selecao.ids.size;

  return (
    <Modal
      open
      onClose={onFechar}
      size="lg"
      title="Adicionar títulos"
      description="Selecione os títulos a receber (multi-seleção) · busca/filtro na barra · Esc fecha"
      primaryAction={{ label: `Adicionar${total ? ` (${total})` : ''}`, onClick: confirmar }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(r) => r.codrcb}
        selectionConfig={{ enabled: true }}
        selectionModel={selecao}
        onSelectionModelChange={setSelecao}
        toolbar={{ enableSearch: true, enableFilters: true }}
        paginationConfig={{ enabled: true, initialPageSize: 10 }}
        cardBreakpoint={false}
      />
    </Modal>
  );
}
