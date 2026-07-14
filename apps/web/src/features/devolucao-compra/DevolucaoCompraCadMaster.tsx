import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { CheckCircle2, RotateCcw, Ban, Trash2, FileOutput, HandCoins } from 'lucide-react';
import type { DevolucaoCompra, ItemDisponivelDevolucao, DevolucaoCompraItemDto } from '@apollo/shared';
import { Button } from '../../shared/ui/Button';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import {
  listarDevolucoes, criarDevolucao, itensDisponiveis, finalizarDevolucao, reabrirDevolucao, cancelarDevolucao, removerDevolucao, gerarNfDevolucao, faturarDevolucao,
} from './devolucaoCompraApi';

const n = (v: unknown) => (Number(v) || 0);
const fmtQtd = (v: unknown) => n(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtMoeda = (v: unknown) => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS_LABEL: Record<string, string> = {
  EM_DIGITACAO: 'Em digitação', DIGITADO: 'Digitado', NOTA_FISCAL_EMITIDA: 'NF emitida', FINALIZADO: 'Finalizado', CANCELADO: 'Cancelado',
};

/**
 * DEVOLUÇÃO DE COMPRA (FRMDEVOLUCAOCOMPRA) — corte-1: tela do documento (sem efeitos). Escolhe o fornecedor,
 * carrega os itens de NF de ENTRADA com SALDO devolvível (picker), define a quantidade a devolver por item, e
 * grava a devolução (EM_DIGITAÇÃO). Abaixo, a lista com o workflow (finalizar/reabrir/cancelar/excluir). O FATO
 * (NF de saída finalidade=4 → estoque−/A Receber) é corte futuro.
 */
export function DevolucaoCompraCadMaster() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<DevolucaoCompra[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [codparceiro, setCodparceiro] = useState<number | undefined>(undefined);
  const [disponiveis, setDisponiveis] = useState<ItemDisponivelDevolucao[]>([]);
  const [qtds, setQtds] = useState<Record<number, number | undefined>>({});

  const { data: fornecedorOptions = [] } = useResourceOptions(
    'cadastro/parceiros',
    (p: any) => ({ value: String(p.codparceiro ?? p.codigo), label: `${p.codparceiro ?? p.codigo} - ${p.razao ?? p.fornecedor ?? ''}` }),
    { campo: 'frn', operador: 'igual', valor: 'S' },
  );

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

  const carregarItens = useCallback(async () => {
    if (codparceiro == null) return;
    try {
      setDisponiveis(await itensDisponiveis(codparceiro));
      setQtds({});
    } catch (e) {
      mensagem.erro(e);
    }
  }, [codparceiro, mensagem]);

  const totalDevolucao = useMemo(
    () => disponiveis.reduce((s, it) => s + n(qtds[it.codnfprod]) * n(it.valor_custo), 0),
    [disponiveis, qtds],
  );
  const temItens = useMemo(() => disponiveis.some((it) => n(qtds[it.codnfprod]) > 0), [disponiveis, qtds]);

  async function gravar() {
    if (codparceiro == null) return;
    const itens: DevolucaoCompraItemDto[] = disponiveis
      .filter((it) => n(qtds[it.codnfprod]) > 0)
      .map((it) => ({
        codnf: it.codnf,
        codnfprod: it.codnfprod,
        idproduto: it.idproduto,
        nroitem: it.nroitem ?? undefined,
        unidade: it.unidade ?? undefined,
        fatorembalagem: n(it.fatorembalagem) || 1,
        cfop: it.cfop_devolucao ?? undefined,
        qtd_nota_fiscal: n(it.qtd_nota_fiscal),
        qtd_devolvida: n(qtds[it.codnfprod]),
        valor_custo: n(it.valor_custo),
        total_produto_nota: n(it.qtd_nota_fiscal) * n(it.valor_custo),
      }));
    if (!itens.length) return; // o botão já fica desabilitado sem itens com qtd > 0
    setSalvando(true);
    try {
      await criarDevolucao({ codparceiro, itens });
      mensagem.sucesso('Devolução gravada em digitação.');
      setDisponiveis([]);
      setQtds({});
      setCodparceiro(undefined);
      await recarregar();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setSalvando(false);
    }
  }

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
        if (st === 'EM_DIGITACAO') {
          acts.push({ id: 'finalizar', label: 'Finalizar', icon: <CheckCircle2 size={16} />, onClick: () => void acao(() => finalizarDevolucao(id), 'Devolução finalizada.') });
          acts.push({ id: 'excluir', label: 'Excluir', icon: <Trash2 size={16} />, destructive: true, onClick: () => void acao(() => removerDevolucao(id), 'Devolução excluída.') });
        }
        if (st === 'DIGITADO') {
          acts.push({ id: 'gerarnf', label: 'Gerar NF', icon: <FileOutput size={16} />, onClick: () => void acao(() => gerarNfDevolucao(id), 'NF de devolução gerada. Processe/fature na tela da NF de saída.') });
          acts.push({ id: 'reabrir', label: 'Reabrir', icon: <RotateCcw size={16} />, onClick: () => void acao(() => reabrirDevolucao(id), 'Devolução reaberta.') });
        }
        if (st === 'NOTA_FISCAL_EMITIDA') {
          acts.push({ id: 'faturar', label: 'Faturar', icon: <HandCoins size={16} />, onClick: () => void acao(() => faturarDevolucao(id), 'Devolução faturada: A Receber gerado contra o fornecedor.') });
        }
        if (st === 'EM_DIGITACAO' || st === 'DIGITADO') {
          acts.push({ id: 'cancelar', label: 'Cancelar', icon: <Ban size={16} />, destructive: true, onClick: () => void acao(() => cancelarDevolucao(id), 'Devolução cancelada.') });
        }
        return acts;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Devolução de Compra" />

      <fieldset className="rounded-radius-md border border-border bg-bg-surface p-pad-md" disabled={salvando}>
        <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Nova devolução</legend>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-96">
            <SelectField label="&Fornecedor" options={fornecedorOptions} value={codparceiro != null ? String(codparceiro) : undefined} onChange={(v) => { setCodparceiro(v ? Number(v) : undefined); setDisponiveis([]); setQtds({}); }} placeholder="Selecione o fornecedor…" />
          </div>
          <Button label="&Carregar itens" variant="soft" disabled={codparceiro == null} onClick={() => void carregarItens()} />
        </div>

        {disponiveis.length > 0 && (
          <div className="mt-form-gap overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-border text-left text-fg-muted">
                  <th className="py-1 pr-3">NF</th>
                  <th className="py-1 pr-3">Item</th>
                  <th className="py-1 pr-3">Produto</th>
                  <th className="py-1 pr-3">CFOP dev.</th>
                  <th className="py-1 pr-3 text-right">Saldo</th>
                  <th className="py-1 pr-3 text-right">Custo</th>
                  <th className="py-1 pr-3 text-right">Qtde a devolver</th>
                </tr>
              </thead>
              <tbody>
                {disponiveis.map((it) => (
                  <tr key={it.codnfprod} className="border-b border-border/50">
                    <td className="py-1 pr-3">{it.nronf ?? it.codnf}</td>
                    <td className="py-1 pr-3">{it.nroitem}</td>
                    <td className="py-1 pr-3">{it.idproduto} - {it.descricao ?? ''}</td>
                    <td className="py-1 pr-3">{it.cfop_devolucao ?? <span className="text-danger">sem CFOP</span>}</td>
                    <td className="py-1 pr-3 text-right">{fmtQtd(it.saldo)}</td>
                    <td className="py-1 pr-3 text-right">{fmtMoeda(it.valor_custo)}</td>
                    <td className="py-1 pr-3 text-right">
                      <div className="ml-auto w-28">
                        <NumberField label="" value={qtds[it.codnfprod]} decimais={3} min={0} max={n(it.saldo)} disabled={!it.cfop_devolucao}
                          onChange={(v) => setQtds((q) => ({ ...q, [it.codnfprod]: v }))} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-form-gap flex items-center justify-between">
              <span className="text-body-sm text-fg-muted">Total a devolver: <strong>{fmtMoeda(totalDevolucao)}</strong></span>
              <Button label="&Gravar devolução" variant="soft" onClick={() => void gravar()} disabled={salvando || !temItens} />
            </div>
          </div>
        )}
        {codparceiro != null && disponiveis.length === 0 && (
          <small className="mt-form-gap block text-fg-muted">Clique em «Carregar itens» para listar as notas de entrada com saldo devolvível deste fornecedor.</small>
        )}
      </fieldset>

      <DataTable columns={colunas} rows={lista} loading={carregando} />
    </div>
  );
}
