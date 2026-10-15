import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Modal } from '../../shared/ui/Modal';
import { CheckCircle2, RotateCcw, Ban, Trash2, FileOutput, HandCoins, FolderOpen } from 'lucide-react';
import { DevolucaoCompraEditor } from './DevolucaoCompraEditor';
import type { DevolucaoCompra } from '@apollo/shared';
import { Button } from '../../shared/ui/Button';
import { SelectField } from '../../shared/ui/SelectField';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import {
  listarDevolucoes, finalizarDevolucao, reabrirDevolucao, cancelarDevolucao, removerDevolucao, gerarNfDevolucao, faturarDevolucao,
} from './devolucaoCompraApi';

const n = (v: unknown) => (Number(v) || 0);
const fmtMoeda = (v: unknown) => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS_LABEL: Record<string, string> = {
  // os valores do legado (STATUS_PEDIDO, com espaço)
  'EM DIGITACAO': 'Em digitação', DIGITADO: 'Digitado', 'NOTA FISCAL EMITIDA': 'NF emitida', FINALIZADO: 'Finalizado', CANCELADO: 'Cancelado',
};

/**
 * PEDIDO DE DEVOLUÇÃO DE COMPRAS (FRMCADPEDIDODEVOLUCAOCOMPRAS, uCadPedidoDevolucaoCompras). "Nova devolução" ou "Abrir" leva ao editor do
 * pedido (`DevolucaoCompraEditor`: fornecedor, observações, itens por NF [F2] ou produto [F7], quantidades, totais, workflow e impressão);
 * abaixo, a lista com as ações de cada situação (finalizar/reabrir/cancelar/excluir, gerar e faturar a NF de devolução).
 */
export function DevolucaoCompraCadMaster() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<DevolucaoCompra[]>([]);
  const [carregando, setCarregando] = useState(true);
  // o pedido aberto no editor (null = novo; undefined = fechado)
  const [aberto, setAberto] = useState<number | null | undefined>(undefined);

  // faturar pede a forma do título a receber (a tela de Contas a Receber que o Faturamento abre; na produção, DEVOLUCAO)
  const [faturando, setFaturando] = useState<number | null>(null);
  const [idpgto, setIdpgto] = useState<string | undefined>(undefined);
  const { data: formaOptions = [] } = useResourceOptions('cadastro/formas-pgto',
    (x: any) => ({ value: String(x.idpgto), label: `${x.idpgto} - ${x.modalidade ?? ''}` }));

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setLista(await listarDevolucoes({ situacao: 'todos', orderBy: 'codpeddevcompra', orderDir: 'desc' }));
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);
  useEffect(() => void recarregar(), [recarregar]);

  const acao = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      mensagem.sucesso(ok);
      await recarregar();
    } catch (e) {
      mensagem.erro(e);
    }
  };

  const colunas: DataTableColumnDef<DevolucaoCompra>[] = [
    { field: 'codpeddevcompra', headerName: 'Cód.', type: 'text', width: 80, isPrimary: true },
    { field: 'fornecedor', headerName: 'Fornecedor', type: 'text' },
    { field: 'data', headerName: 'Data', type: 'text', width: 150, valueGetter: (r) => (r.data ? new Date(r.data).toLocaleString('pt-BR') : '') },
    { field: 'status', headerName: 'Situação', type: 'text', width: 130, valueGetter: (r) => STATUS_LABEL[String(r.status)] ?? String(r.status ?? '') },
    { field: 'qtde_itens', headerName: 'Itens', type: 'number', width: 80 },
    { field: 'total', headerName: 'Total', type: 'number', width: 130, valueGetter: (r) => fmtMoeda(r.total) },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 160,
      getActions: ({ row: r }: { row: DevolucaoCompra }) => {
        const id = Number(r.codpeddevcompra);
        const st = String(r.status);
        const acts: any[] = [];
        acts.push({ id: 'abrir', label: 'Abrir', icon: <FolderOpen size={16} />, onClick: () => setAberto(id) });
        if (st === 'EM DIGITACAO') {
          acts.push({ id: 'finalizar', label: 'Finalizar', icon: <CheckCircle2 size={16} />, onClick: () => void acao(() => finalizarDevolucao(id), 'Devolução finalizada.') });
          acts.push({ id: 'excluir', label: 'Excluir', icon: <Trash2 size={16} />, destructive: true, onClick: () => void acao(() => removerDevolucao(id), 'Devolução excluída.') });
        }
        if (st === 'DIGITADO') {
          acts.push({ id: 'gerarnf', label: 'Gerar NF', icon: <FileOutput size={16} />, onClick: () => void acao(() => gerarNfDevolucao(id), 'NF de devolução gerada. Processe/fature na tela da NF de saída.') });
          acts.push({ id: 'reabrir', label: 'Reabrir', icon: <RotateCcw size={16} />, onClick: () => void acao(() => reabrirDevolucao(id), 'Devolução reaberta.') });
        }
        if (st === 'NOTA FISCAL EMITIDA') {
          acts.push({ id: 'faturar', label: 'Faturar', icon: <HandCoins size={16} />, onClick: () => { setIdpgto(undefined); setFaturando(id); } });
        }
        if (st === 'EM DIGITACAO' || st === 'DIGITADO') {
          acts.push({ id: 'cancelar', label: 'Cancelar', icon: <Ban size={16} />, destructive: true, onClick: () => void acao(() => cancelarDevolucao(id), 'Devolução cancelada.') });
        }
        return acts;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Devolução de Compra" />

      {aberto === undefined
        ? <div><Button label="&Nova devolução" variant="soft" onClick={() => setAberto(null)} /></div>
        : <DevolucaoCompraEditor codigo={aberto} onFechar={() => setAberto(undefined)} onMudou={() => void recarregar()} />}

      <DataTable columns={colunas} rows={lista} loading={carregando} getRowId={(r: any) => Number(r.codpeddevcompra)} />

      {faturando != null && (
        <Modal open onClose={() => setFaturando(null)} size="sm" title="Faturar devolução"
          primaryAction={{ label: 'Faturar', disabled: !idpgto, onClick: () => { const id = faturando; setFaturando(null); void acao(() => faturarDevolucao(id, Number(idpgto)), 'Devolução faturada: A Receber gerado contra o fornecedor.'); } }}
          secondaryAction={{ label: 'Cancelar', onClick: () => setFaturando(null) }}>
          <SelectField label="&Forma de pagamento" options={formaOptions} value={idpgto} onChange={(v) => setIdpgto(v || undefined)} placeholder="Selecione a forma…" />
        </Modal>
      )}
    </div>
  );
}
