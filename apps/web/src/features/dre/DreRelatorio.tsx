import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { DateField } from '../../shared/ui/DateField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { calcularDre, type LinhaDre } from './dreApi';

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const anoInicio = () => `${new Date().getFullYear()}-01-01`;
const hojeISO = () => new Date().toISOString().slice(0, 10);

/**
 * DRE CONTÁBIL (relatório) — corte-1. Demonstração do Resultado calculada do DIÁRIO por período/empresa
 * (motor P/F/E no backend). Árvore por `codpai` (DataTable tree-data, igual ao Plano de Contas) + filtro
 * de período. Somente leitura. Editor da estrutura = corte-2.
 */
export function DreRelatorio() {
  const mensagem = useMensagem();
  const [dataInicio, setDataInicio] = useState<string | undefined>(anoInicio());
  const [dataFim, setDataFim] = useState<string | undefined>(hojeISO());
  const [linhas, setLinhas] = useState<LinhaDre[]>([]);
  const [carregando, setCarregando] = useState(false);

  const gerar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await calcularDre(dataInicio, dataFim);
      setLinhas(r.linhas);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [dataInicio, dataFim, mensagem]);
  useEffect(() => { void gerar(); /* carrega ao abrir */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // árvore por codpai (mesmo padrão do Plano de Contas).
  const byId = useMemo(() => new Map(linhas.map((l) => [l.codestrutura, l])), [linhas]);
  const treeDataPath = useCallback(
    (row: LinhaDre): Array<string | number> => {
      const path: number[] = [];
      const seen = new Set<number>();
      let cur: LinhaDre | undefined = row;
      while (cur && !seen.has(cur.codestrutura)) {
        path.unshift(cur.codestrutura);
        seen.add(cur.codestrutura);
        cur = cur.codpai != null ? byId.get(cur.codpai) : undefined;
      }
      return path;
    },
    [byId],
  );

  const columns = useMemo<DataTableColumnDef<LinhaDre>[]>(
    () => [
      { field: 'descricao', headerName: 'Conta / Linha do DRE', type: 'text', isPrimary: true, treeColumn: true },
      { field: 'codexpandido', headerName: 'Código', type: 'text', width: 130 },
      {
        field: 'valor', headerName: 'Valor (R$)', type: 'number', width: 200,
        valueGetter: (r) => fmtBRL(Number(r.valor) || 0),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-form-gap max-w-5xl">
      <PageHeader title="DRE — Demonstração do Resultado" description="Calculada do Diário por período (crédito − débito). Sintéticas somam as filhas; fórmulas combinam os grupos." />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-44"><DateField label="Data &inicial" value={dataInicio} onChange={setDataInicio} /></div>
        <div className="w-44"><DateField label="Data &final" value={dataFim} onChange={setDataFim} /></div>
        <Button label="&Gerar DRE" variant="soft" onClick={() => void gerar()} />
      </div>
      {carregando ? (
        <small className="text-fg-muted">Calculando o DRE…</small>
      ) : linhas.length === 0 ? (
        <small className="text-fg-muted">Sem estrutura de DRE ou sem movimento no período.</small>
      ) : (
        <DataTable
          rows={linhas}
          columns={columns}
          getRowId={(r) => r.codestrutura}
          getTreeDataPath={treeDataPath}
          treeData={{ defaultExpanded: true }}
          toolbar={{ enableSearch: false, enableFilters: false }}
          paginationConfig={{ enabled: false }}
          cardBreakpoint={false}
        />
      )}
    </div>
  );
}
