import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, Modal, PageHeader } from '@apollosg/design-system';
import { Pencil, Trash2, Ban, RotateCcw } from 'lucide-react';
import {
  PC_CLASSE_OPCOES, PC_NATUREZA_OPCOES, type PlanoConta,
} from '@apollo/shared';
import { createResourceApi } from '../../shared/cadmaster/resourceApi';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import type { Opcao } from '../../shared/cadmaster/useResourceOptions';

const api = createResourceApi<PlanoConta>('cadastro/plano-contas');
const statusApi = async (id: number, status: 'A' | 'I') => {
  const res = await fetch(`${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/cadastro/plano-contas/${id}/status`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ status }),
  });
  handle401(res);
  return res;
};

const natLabel = (n?: number) => PC_NATUREZA_OPCOES.find((o) => o.value === n)?.label ?? (n != null ? String(n) : '');

/**
 * PLANO DE CONTAS (uCadPlanoContas) — cadastro contábil em ÁRVORE. Browse via DataTable tree-data do DS
 * (a hierarquia é montada por `codpai` — o backend é flat) + editor modal por conta (add/editar). Travas
 * de exclusão e validações (prefixo-do-pai, pai-sintética) vêm do servidor (422 PT, via useMensagem).
 */
export function PlanoContasCadMaster() {
  const mensagem = useMensagem();
  const [contas, setContas] = useState<PlanoConta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [editor, setEditor] = useState<{ conta?: PlanoConta; codpaiInicial?: number } | null>(null);

  const load = useCallback(async () => {
    setCarregando(true);
    try {
      setContas(await api.listar({ situacao: 'todos' }));
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);
  useEffect(() => { void load(); }, [load]);

  // mapa p/ montar o caminho da árvore (raiz → nó) por codpai.
  const byId = useMemo(() => new Map(contas.map((c) => [c.codplanocontas, c])), [contas]);
  const treeDataPath = useCallback(
    (row: PlanoConta): Array<string | number> => {
      const path: number[] = [];
      const seen = new Set<number>();
      let cur: PlanoConta | undefined = row;
      while (cur && !seen.has(cur.codplanocontas)) {
        path.unshift(cur.codplanocontas);
        seen.add(cur.codplanocontas);
        cur = cur.codpai != null ? byId.get(cur.codpai) : undefined;
      }
      return path;
    },
    [byId],
  );

  // contas sintéticas (T) = possíveis pais.
  const sinteticasOpcoes: Opcao[] = useMemo(
    () => contas.filter((c) => c.classe === 'T').map((c) => ({ value: String(c.codplanocontas), label: `${c.codiexpandido} - ${c.descricao}` })),
    [contas],
  );

  const excluir = async (c: PlanoConta) => {
    if (!window.confirm(`Excluir a conta ${c.codiexpandido} - ${c.descricao}?`)) return;
    try {
      await api.excluir(c.codplanocontas);
      mensagem.sucesso('Conta excluída.');
      void load();
    } catch (e) {
      mensagem.erro(e);
    }
  };
  const alternarStatus = async (c: PlanoConta) => {
    const novo = c.status === 'I' ? 'A' : 'I';
    try {
      const r = await statusApi(c.codplanocontas, novo);
      if (!r.ok) throw Object.assign(new Error('erro'), { envelope: await r.json().catch(() => ({})) });
      mensagem.sucesso(novo === 'I' ? 'Conta inativada.' : 'Conta reativada.');
      void load();
    } catch (e) {
      mensagem.erro(e);
    }
  };

  const columns = useMemo<DataTableColumnDef<PlanoConta>[]>(
    () => [
      { field: 'descricao', headerName: 'Conta', type: 'text', isPrimary: true, treeColumn: true },
      { field: 'codiexpandido', headerName: 'Código', type: 'text', width: 180 },
      {
        field: 'classe', headerName: 'Classe', type: 'text', width: 110,
        valueGetter: (r) => (r.classe === 'T' ? 'Sintética' : 'Analítica'),
      },
      { field: 'natureza', headerName: 'Natureza', type: 'text', width: 200, valueGetter: (r) => natLabel(r.natureza) },
      { field: 'status', headerName: 'Status', type: 'text', width: 90, valueGetter: (r) => (r.status === 'I' ? 'Inativa' : 'Ativa') },
      {
        field: 'acoes', headerName: '', type: 'actions', width: 150,
        getActions: ({ row: r }: { row: PlanoConta }) => [
          {
            id: 'add', label: 'Adicionar filha', icon: <span aria-hidden>＋</span>,
            disabled: r.classe !== 'T',
            onClick: (row: PlanoConta) => setEditor({ codpaiInicial: row.codplanocontas }),
          },
          { id: 'editar', label: 'Editar', icon: <Pencil className="size-icon-sm" strokeWidth={1.7} aria-hidden />, onClick: (row: PlanoConta) => setEditor({ conta: row }) },
          {
            id: 'status', label: r.status === 'I' ? 'Reativar' : 'Inativar',
            icon: r.status === 'I' ? <RotateCcw className="size-icon-sm" strokeWidth={1.7} aria-hidden /> : <Ban className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            onClick: (row: PlanoConta) => void alternarStatus(row),
          },
          { id: 'remover', label: 'Excluir', icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />, destructive: true, onClick: (row: PlanoConta) => void excluir(row) },
        ],
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="flex flex-col gap-form-gap max-w-6xl">
      <PageHeader title="Plano de Contas" description="Razão contábil em árvore — sintéticas agrupam, analíticas recebem lançamento." />
      <div className="flex gap-gp-sm">
        <Button label="Adicionar conta &raiz" variant="soft" onClick={() => setEditor({})} />
      </div>
      {carregando ? (
        <small className="text-fg-muted">Carregando o plano de contas…</small>
      ) : (
        <DataTable
          rows={contas}
          columns={columns}
          getRowId={(r) => r.codplanocontas}
          getTreeDataPath={treeDataPath}
          treeData={{ defaultExpanded: false }}
          toolbar={{ enableSearch: true, enableFilters: false }}
          paginationConfig={{ enabled: false }}
          cardBreakpoint={false}
        />
      )}

      {editor && (
        <ContaModal
          inicial={editor.conta}
          codpaiInicial={editor.codpaiInicial}
          sinteticasOpcoes={sinteticasOpcoes}
          byId={byId}
          onFechar={() => setEditor(null)}
          onSalvo={() => { setEditor(null); void load(); }}
        />
      )}
    </div>
  );
}

function ContaModal({
  inicial,
  codpaiInicial,
  sinteticasOpcoes,
  byId,
  onFechar,
  onSalvo,
}: {
  inicial?: PlanoConta;
  codpaiInicial?: number;
  sinteticasOpcoes: Opcao[];
  byId: Map<number, PlanoConta>;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const mensagem = useMensagem();
  const editando = inicial != null;
  const paiInicial = inicial?.codpai ?? codpaiInicial;
  const pai = paiInicial != null ? byId.get(paiInicial) : undefined;
  const [codiexpandido, setCodiexpandido] = useState(inicial?.codiexpandido ?? (pai?.codiexpandido ? `${pai.codiexpandido}.` : ''));
  const [descricao, setDescricao] = useState(inicial?.descricao ?? '');
  const [classe, setClasse] = useState<string | undefined>(inicial?.classe ?? 'A');
  const [natureza, setNatureza] = useState<string | undefined>(
    inicial?.natureza != null ? String(inicial.natureza) : pai?.natureza != null ? String(pai.natureza) : undefined,
  );
  const [codpai, setCodpai] = useState<string | undefined>(paiInicial != null ? String(paiInicial) : undefined);
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (salvando) return;
    setSalvando(true);
    try {
      const dto = {
        codiexpandido,
        descricao,
        classe,
        natureza: natureza != null ? Number(natureza) : undefined,
        codpai: codpai != null ? Number(codpai) : undefined,
      };
      if (editando) await api.atualizar(inicial!.codplanocontas, dto);
      else await api.criar(dto);
      mensagem.sucesso(editando ? 'Conta atualizada.' : 'Conta criada.');
      onSalvo();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onFechar}
      size="md"
      title={editando ? `Editar conta ${inicial?.codiexpandido ?? ''}` : 'Nova conta contábil'}
      primaryAction={{ label: 'Salvar', onClick: () => void salvar() }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-form-gap">
        <SelectField
          label="Conta-&pai (sintética)"
          options={sinteticasOpcoes}
          value={codpai}
          onChange={setCodpai}
          placeholder="— raiz (sem pai) —"
        />
        <Field
          label="&Código (máscara, ex.: 1.1.03.01.0002)"
          inputMode="numeric"
          value={codiexpandido}
          onChange={(e) => setCodiexpandido(e.target.value)}
        />
        <Field label="&Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={120} />
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <SelectField label="C&lasse" options={PC_CLASSE_OPCOES as unknown as Opcao[]} value={classe} onChange={setClasse} placeholder="Selecione…" />
          <SelectField
            label="&Natureza"
            options={PC_NATUREZA_OPCOES.map((o) => ({ value: String(o.value), label: o.label }))}
            value={natureza}
            onChange={setNatureza}
            placeholder="Selecione…"
          />
        </div>
        <small className="text-fg-muted">
          Sintética agrupa (não recebe lançamento); analítica é folha lançável. O código deve conter o prefixo do pai.
        </small>
      </div>
    </Modal>
  );
}
