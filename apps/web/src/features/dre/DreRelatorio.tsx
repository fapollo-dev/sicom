import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { DateField } from '../../shared/ui/DateField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { calcularDre, relatorioDre, type LinhaDre } from './dreApi';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { hojeNaLoja } from '../../shared/tempo';
import { CodigosComPesquisa } from '../../shared/pesquisa/CodigosComPesquisa';

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const anoInicio = () => `${new Date().getFullYear()}-01-01`;
const hojeISO = () => hojeNaLoja();

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
  // os filtros do "Imprimir" (TFrmRelDREContabil): as lojas, o filtro de plano de contas, "Não exibir zerados" e os níveis expandidos
  const [empresas, setEmpresas] = useState('');
  const [planos, setPlanos] = useState('');
  const [naoZerados, setNaoZerados] = useState(false);
  const [niveis, setNiveis] = useState('2');
  const [observacoes, setObservacoes] = useState<string[]>([]);
  const consulta = () => {
    const q = new URLSearchParams({ dataInicio: dataInicio ?? '', dataFim: dataFim ?? '', niveis });
    if (empresas.trim()) q.set('empresas', empresas.replace(/\s/g, ''));
    if (planos.trim()) q.set('planos', planos.replace(/\s/g, ''));
    if (naoZerados) q.set('naoExibirZerados', '1');
    return q.toString();
  };
  // o legado avisa das contas sem vínculo (a guia Observações) antes de imprimir; conta de resultado sem vínculo bloqueia
  const imprimir = () => {
    imprimirRelatorio(`/cadastro/dre/impressao?${consulta()}`, undefined, async () => {
      try {
        const r = await relatorioDre(consulta());
        setObservacoes(r.semVinculo.map((x) => x.conta));
        if (r.aviso) window.alert(r.aviso);
      } catch (e) {
        const contas = (e as { body?: { detalhe?: { contas?: Array<{ conta: string }> } } }).body?.detalhe?.contas;
        if (contas) setObservacoes(contas.map((x) => x.conta));
        throw e;
      }
    }).catch((e) => mensagem.erro(e));
  };

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
        <div className="w-36"><Field label="&Empresas (1,2)" value={empresas} onChange={(e) => setEmpresas(e.target.value)} placeholder="esta loja" /></div>
        {/* UFrmRelDREContabil.pas:494-502: a GET_PLANO_CONTAS em multisseleção; os marcados substituem a lista */}
        <CodigosComPesquisa label="Filtro de &plano de contas" value={planos} onChange={setPlanos} recurso="lookup/plano-contas" placeholder="F3 pesquisa · ex. 124,211" />
        <div className="w-36"><SelectField label="Níveis e&xpandidos" options={[{ value: '0', label: '' }, { value: '1', label: '1 nível' }, { value: '2', label: '2 níveis' }, { value: '3', label: '3 níveis' }]} value={niveis} onChange={(v) => setNiveis(v ?? '0')} /></div>
        <label className="flex items-center gap-gp-xs text-body-sm"><input type="checkbox" checked={naoZerados} onChange={(e) => setNaoZerados(e.target.checked)} /> Não exibir zerados</label>
        <Button label="Im&primir" onClick={imprimir} />
      </div>
      {observacoes.length > 0 && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md text-body-sm">
          <h3 className="mb-pad-xs font-semibold">Observações — planos de contas sem vinculação</h3>
          <ul className="list-disc pl-pad-md">{observacoes.map((o) => <li key={o}>{o}</li>)}</ul>
        </section>
      )}
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
