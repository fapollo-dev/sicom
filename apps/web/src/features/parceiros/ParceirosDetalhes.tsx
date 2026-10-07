import { useMemo, useState } from 'react';
import { type UseFormReturn, useFieldArray } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumnDef } from '@apollosg/design-system';
import { Modal } from '../../shared/ui/Modal';
import {
  type BancoParceiroDto,
  type CriarParceiroDto,
  type PgtoParceiroDto,
  type RelParceiroDto,
  type VendedorParceiroDto,
} from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { LookupField } from '../../shared/ui/LookupField';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * Detalhes 1:N do PARCEIRO (Fase 2) — espelham o grid de Endereços (ParceirosCadMaster):
 * cada seção é um <fieldset> com DataTable + Adicionar/Editar/Remover via `useFieldArray`,
 * e um Modal LOCAL de ADICIONAR/EDITAR um item. Itens recém-adicionados aparecem na hora;
 * no save, o engine de agregado grava master + todos os detalhes numa transação.
 *
 * São 4: Bancos (PARCEIROS_BANCOS), Formas de pagamento (PARCEIROS_PGTO), Relacionamentos
 * (PARCEIROS_REL) e Vendedores (PARCEIROS_VENDEDORES).
 */

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Linha = Record<string, any>;

/**
 * Os nomes SÓ dos códigos que a grade mostra — a Pesquisa da view com "Contido em" (`campo IN (1,2,3)`). O combo de antes
 * (`useResourceOptions`) trazia 200 linhas sem ordem da tabela inteira e a grade caía no código cru para o resto.
 */
function useNomesDosCodigos(recurso: string, campo: string, codigos: ReadonlyArray<number | null | undefined>) {
  const lista = Array.from(new Set(codigos.filter((c): c is number => c != null))).sort((a, b) => a - b);
  return useQuery({
    queryKey: ['pesquisa-nomes', recurso, campo, lista],
    enabled: lista.length > 0,
    queryFn: async () => {
      const qs = new URLSearchParams({ recurso, campo, operacao: 'contido', valor: lista.join(','), situacao: 'todos', porPagina: '1000' });
      const r = await fetch(`${BASE}/cadastro/pesquisa?${qs.toString()}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) throw new Error(r.statusText);
      const j = (await r.json()) as { linhas: Linha[] };
      return new Map(j.linhas.map((l) => [String(l[campo]), l]));
    },
  });
}

/** célula utilitária: "cod - nome" a partir da linha da view (sem a linha, o código cru). */
function rotuloCodigo(nomes: Map<string, Linha> | undefined, value: number | undefined, coluna: string): string {
  if (value == null) return '';
  const l = nomes?.get(String(value));
  return l ? `${value} - ${l[coluna] ?? ''}` : String(value);
}

// ───────────────────────────── Bancos ─────────────────────────────

/**
 * Dados bancários (PARCEIROS_BANCOS). Banco via o campo de lookup `lookup/bancos` (GET_BANCOS: codigo → banco);
 * agência e nº conta são texto. Modal local com LookupField (banco) + Field (agência/conta).
 */
export function BancosSection({
  form,
  editavel,
}: {
  form: UseFormReturn<CriarParceiroDto>;
  editavel: boolean;
}) {
  const { fields, append, update, remove } = useFieldArray<CriarParceiroDto, 'bancos', 'fieldId'>({
    control: form.control,
    name: 'bancos',
    keyName: 'fieldId',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);

  // a grade mostra "cod - banco" só dos bancos das linhas (get_bancos expõe a PK CODBCO como `codigo`)
  const { data: nomesBancos } = useNomesDosCodigos('lookup/bancos', 'codigo', fields.map((f) => f.codbco));

  const onConfirmar = (item: BancoParceiroDto) => {
    if (editIdx == null) return;
    if (editIdx < 0) append(item);
    else update(editIdx, item);
    setEditIdx(null);
  };

  const columns = useMemo<DataTableColumnDef<BancoParceiroDto & { fieldId: string }>[]>(
    () => [
      {
        field: 'codbco',
        headerName: 'Banco',
        type: 'text',
        isPrimary: true,
        valueGetter: (row) => rotuloCodigo(nomesBancos, row.codbco, 'banco'),
      },
      { field: 'agencia', headerName: 'Agência', type: 'text', width: 150 },
      { field: 'nrconta', headerName: 'Nº conta', type: 'text', width: 180 },
      acoesColumn(fields, setEditIdx, remove),
    ],
    [fields, remove, nomesBancos],
  );

  return (
    <DetalheGrid
      titulo="Bancos"
      botaoLabel="Adicionar &banco"
      vazio="Sem dados bancários."
      editavel={editavel}
      onAdicionar={() => setEditIdx(-1)}
      rows={fields as Array<BancoParceiroDto & { fieldId: string }>}
      columns={columns}
    >
      {editIdx != null && (
        <BancoModal
          inicial={editIdx >= 0 ? (fields[editIdx] as BancoParceiroDto) : undefined}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </DetalheGrid>
  );
}

const BANCO_VAZIO: BancoParceiroDto = {};

function BancoModal({
  inicial,
  onFechar,
  onConfirmar,
}: {
  inicial?: BancoParceiroDto;
  onFechar: () => void;
  onConfirmar: (item: BancoParceiroDto) => void;
}) {
  const [item, setItem] = useState<BancoParceiroDto>(inicial ?? BANCO_VAZIO);
  const set = <K extends keyof BancoParceiroDto>(k: K, v: BancoParceiroDto[K]) =>
    setItem((i) => ({ ...i, [k]: v }));
  return (
    <Modal
      open
      onClose={onFechar}
      size="md"
      title={inicial ? 'Editar dados bancários' : 'Adicionar dados bancários'}
      primaryAction={{ label: 'Salvar', onClick: () => onConfirmar(item) }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
        {/* uCadClientes.pas:4177 (getPesquisa 01) — GET_BANCOS, CODIGO/BANCO, sem filtro */}
        <div className="sm:col-span-2">
          <LookupField
            label="&Banco"
            recurso="lookup/bancos"
            campoCodigo="codigo"
            descricao="banco"
            value={item.codbco}
            onChange={(cod) => set('codbco', cod ? Number(cod) : undefined)}
          />
        </div>
        <Field
          label="&Agência"
          value={item.agencia ?? ''}
          onChange={(e) => set('agencia', e.target.value)}
        />
        <Field
          label="Nº &conta"
          value={item.nrconta ?? ''}
          onChange={(e) => set('nrconta', e.target.value)}
        />
      </div>
    </Modal>
  );
}

// ────────────────────────── Formas de pagamento ──────────────────────────

/**
 * Formas de pagamento liberadas (PARCEIROS_PGTO). IDPgto e Modalidade são inputs simples.
 * TODO F3: trocar o IDPgto por um lookup data-bound FORMAS_PGTO (hoje deferido → input numérico).
 */
export function PgtosSection({
  form,
  editavel,
}: {
  form: UseFormReturn<CriarParceiroDto>;
  editavel: boolean;
}) {
  const { fields, append, update, remove } = useFieldArray<CriarParceiroDto, 'pgtos', 'fieldId'>({
    control: form.control,
    name: 'pgtos',
    keyName: 'fieldId',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const onConfirmar = (item: PgtoParceiroDto) => {
    if (editIdx == null) return;
    if (editIdx < 0) append(item);
    else update(editIdx, item);
    setEditIdx(null);
  };

  const columns = useMemo<DataTableColumnDef<PgtoParceiroDto & { fieldId: string }>[]>(
    () => [
      { field: 'idpgto', headerName: 'IDPgto', type: 'text', width: 140 },
      { field: 'modalidade', headerName: 'Modalidade', type: 'text', isPrimary: true },
      acoesColumn(fields, setEditIdx, remove),
    ],
    [fields, remove],
  );

  return (
    <DetalheGrid
      titulo="Formas de pagamento"
      botaoLabel="Adicionar forma de &pagamento"
      vazio="Sem formas de pagamento."
      editavel={editavel}
      onAdicionar={() => setEditIdx(-1)}
      rows={fields as Array<PgtoParceiroDto & { fieldId: string }>}
      columns={columns}
    >
      {editIdx != null && (
        <PgtoModal
          inicial={editIdx >= 0 ? (fields[editIdx] as PgtoParceiroDto) : undefined}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </DetalheGrid>
  );
}

const PGTO_VAZIO: PgtoParceiroDto = {};

function PgtoModal({
  inicial,
  onFechar,
  onConfirmar,
}: {
  inicial?: PgtoParceiroDto;
  onFechar: () => void;
  onConfirmar: (item: PgtoParceiroDto) => void;
}) {
  const [item, setItem] = useState<PgtoParceiroDto>(inicial ?? PGTO_VAZIO);
  const set = <K extends keyof PgtoParceiroDto>(k: K, v: PgtoParceiroDto[K]) =>
    setItem((i) => ({ ...i, [k]: v }));
  return (
    <Modal
      open
      onClose={onFechar}
      size="md"
      title={inicial ? 'Editar forma de pagamento' : 'Adicionar forma de pagamento'}
      primaryAction={{ label: 'Salvar', onClick: () => onConfirmar(item) }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
        {/* TODO F3: lookup FORMAS_PGTO (data-bound). Por ora, IDPgto é input numérico simples. */}
        <Field
          label="&IDPgto"
          value={item.idpgto != null ? String(item.idpgto) : ''}
          inputMode="numeric"
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, '');
            set('idpgto', d === '' ? undefined : Number(d));
          }}
        />
        <Field
          label="&Modalidade"
          value={item.modalidade ?? ''}
          onChange={(e) => set('modalidade', e.target.value)}
        />
      </div>
    </Modal>
  );
}

// ────────────────────────── Relacionamentos ──────────────────────────

/** Relacionamentos/contatos (PARCEIROS_REL). Todos os campos são texto. */
export function RelacionamentosSection({
  form,
  editavel,
}: {
  form: UseFormReturn<CriarParceiroDto>;
  editavel: boolean;
}) {
  const { fields, append, update, remove } = useFieldArray<
    CriarParceiroDto,
    'relacionamentos',
    'fieldId'
  >({
    control: form.control,
    name: 'relacionamentos',
    keyName: 'fieldId',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const onConfirmar = (item: RelParceiroDto) => {
    if (editIdx == null) return;
    if (editIdx < 0) append(item);
    else update(editIdx, item);
    setEditIdx(null);
  };

  const columns = useMemo<DataTableColumnDef<RelParceiroDto & { fieldId: string }>[]>(
    () => [
      { field: 'nome', headerName: 'Nome', type: 'text', isPrimary: true },
      { field: 'tiporel', headerName: 'Tipo', type: 'text', width: 140 },
      { field: 'telefone', headerName: 'Telefone', type: 'text', width: 150 },
      { field: 'celular', headerName: 'Celular', type: 'text', width: 150 },
      { field: 'doc1', headerName: 'Doc 1', type: 'text', width: 140 },
      { field: 'doc2', headerName: 'Doc 2', type: 'text', width: 140 },
      { field: 'endereco', headerName: 'Endereço', type: 'text' },
      acoesColumn(fields, setEditIdx, remove),
    ],
    [fields, remove],
  );

  return (
    <DetalheGrid
      titulo="Relacionamentos"
      botaoLabel="Adicionar &relacionamento"
      vazio="Sem relacionamentos."
      editavel={editavel}
      onAdicionar={() => setEditIdx(-1)}
      rows={fields as Array<RelParceiroDto & { fieldId: string }>}
      columns={columns}
    >
      {editIdx != null && (
        <RelacionamentoModal
          inicial={editIdx >= 0 ? (fields[editIdx] as RelParceiroDto) : undefined}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </DetalheGrid>
  );
}

const REL_VAZIO: RelParceiroDto = {};

function RelacionamentoModal({
  inicial,
  onFechar,
  onConfirmar,
}: {
  inicial?: RelParceiroDto;
  onFechar: () => void;
  onConfirmar: (item: RelParceiroDto) => void;
}) {
  const [item, setItem] = useState<RelParceiroDto>(inicial ?? REL_VAZIO);
  const set = <K extends keyof RelParceiroDto>(k: K, v: RelParceiroDto[K]) =>
    setItem((i) => ({ ...i, [k]: v }));
  return (
    <Modal
      open
      onClose={onFechar}
      size="lg"
      title={inicial ? 'Editar relacionamento' : 'Adicionar relacionamento'}
      primaryAction={{ label: 'Salvar', onClick: () => onConfirmar(item) }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="&Nome" value={item.nome ?? ''} onChange={(e) => set('nome', e.target.value)} />
        </div>
        <Field
          label="&Tipo"
          value={item.tiporel ?? ''}
          onChange={(e) => set('tiporel', e.target.value)}
        />
        <Field
          label="&Endereço"
          value={item.endereco ?? ''}
          onChange={(e) => set('endereco', e.target.value)}
        />
        <Field
          label="Te&lefone"
          value={item.telefone ?? ''}
          inputMode="tel"
          onChange={(e) => set('telefone', e.target.value)}
        />
        <Field
          label="&Celular"
          value={item.celular ?? ''}
          inputMode="tel"
          onChange={(e) => set('celular', e.target.value)}
        />
        <Field label="&Doc 1" value={item.doc1 ?? ''} onChange={(e) => set('doc1', e.target.value)} />
        <Field label="Doc &2" value={item.doc2 ?? ''} onChange={(e) => set('doc2', e.target.value)} />
      </div>
    </Modal>
  );
}

// ────────────────────────── Vendedores ──────────────────────────

/**
 * Vendedores vinculados (PARCEIROS_VENDEDORES). codvendedor via o campo de lookup `lookup/parceiros`
 * filtrado por FUN='S' → mostra "cod - razão".
 */
export function VendedoresSection({
  form,
  editavel,
}: {
  form: UseFormReturn<CriarParceiroDto>;
  editavel: boolean;
}) {
  const { fields, append, update, remove } = useFieldArray<
    CriarParceiroDto,
    'vendedores',
    'fieldId'
  >({
    control: form.control,
    name: 'vendedores',
    keyName: 'fieldId',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);

  // a grade mostra "cod - razão" só dos vendedores das linhas
  const { data: nomesVendedores } = useNomesDosCodigos('lookup/parceiros', 'codparceiro', fields.map((f) => f.codvendedor));

  const onConfirmar = (item: VendedorParceiroDto) => {
    if (editIdx == null) return;
    if (editIdx < 0) append(item);
    else update(editIdx, item);
    setEditIdx(null);
  };

  const columns = useMemo<DataTableColumnDef<VendedorParceiroDto & { fieldId: string }>[]>(
    () => [
      {
        field: 'codvendedor',
        headerName: 'Vendedor',
        type: 'text',
        isPrimary: true,
        valueGetter: (row) => rotuloCodigo(nomesVendedores, row.codvendedor, 'fantasia'), // a grade de vendedores mostra a FANTASIA (uCadClientes.pas:1012)
      },
      acoesColumn(fields, setEditIdx, remove),
    ],
    [fields, remove, nomesVendedores],
  );

  return (
    <DetalheGrid
      titulo="Vendedores"
      botaoLabel="Adicionar &vendedor"
      vazio="Sem vendedores vinculados."
      editavel={editavel}
      onAdicionar={() => setEditIdx(-1)}
      rows={fields as Array<VendedorParceiroDto & { fieldId: string }>}
      columns={columns}
    >
      {editIdx != null && (
        <VendedorModal
          inicial={editIdx >= 0 ? (fields[editIdx] as VendedorParceiroDto) : undefined}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </DetalheGrid>
  );
}

const VENDEDOR_VAZIO: VendedorParceiroDto = {};

function VendedorModal({
  inicial,
  onFechar,
  onConfirmar,
}: {
  inicial?: VendedorParceiroDto;
  onFechar: () => void;
  onConfirmar: (item: VendedorParceiroDto) => void;
}) {
  const [item, setItem] = useState<VendedorParceiroDto>(inicial ?? VENDEDOR_VAZIO);
  return (
    <Modal
      open
      onClose={onFechar}
      size="md"
      title={inicial ? 'Editar vendedor' : 'Adicionar vendedor'}
      primaryAction={{ label: 'Salvar', onClick: () => onConfirmar(item) }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      {/* uCadClientes.pas:993-1019 (BtnAdicionarVendedoresClick) — GET_PARCEIROS, CODIGO/FANTASIA, FUN='S' */}
      <LookupField
        label="&Vendedor"
        recurso="lookup/parceiros"
        campoCodigo="codparceiro"
        descricao="fantasia" // o vendedor mostra a FANTASIA (uCadClientes.pas:4214, :1012)
        fixos={{ fun: 'S' }}
        value={item.codvendedor}
        onChange={(cod) => setItem({ codvendedor: cod ? Number(cod) : undefined })}
      />
    </Modal>
  );
}

// ───────────────────── Infra compartilhada dos grids ─────────────────────

/** coluna de ações (Editar/Remover) — idêntica à de Endereços, parametrizada por seção. */
function acoesColumn<T extends { fieldId: string }>(
  fields: readonly T[],
  setEditIdx: (i: number) => void,
  remove: (i: number) => void,
): DataTableColumnDef<T> {
  return {
    field: 'acoes',
    headerName: '',
    type: 'actions',
    width: 110,
    getActions: () => [
      {
        id: 'editar',
        label: 'Editar',
        icon: <Pencil className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
        onClick: (r: T) => {
          const idx = fields.findIndex((f) => f.fieldId === (r as any).fieldId);
          if (idx >= 0) setEditIdx(idx);
        },
      },
      {
        id: 'remover',
        label: 'Remover',
        icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
        destructive: true,
        onClick: (r: T) => {
          const idx = fields.findIndex((f) => f.fieldId === (r as any).fieldId);
          if (idx >= 0) remove(idx);
        },
      },
    ],
  };
}

/**
 * Casca visual de um grid de detalhe (fieldset + botão Adicionar + DataTable ou "vazio"),
 * espelhando a seção de Endereços. O Modal do item é passado como children (renderizado
 * condicionalmente pelo chamador).
 */
function DetalheGrid<T extends { fieldId: string }>({
  titulo,
  botaoLabel,
  vazio,
  editavel,
  onAdicionar,
  rows,
  columns,
  children,
}: {
  titulo: string;
  botaoLabel: string;
  vazio: string;
  editavel: boolean;
  onAdicionar: () => void;
  rows: T[];
  columns: DataTableColumnDef<T>[];
  children?: React.ReactNode;
}) {
  return (
    <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">{titulo}</legend>
      <div className="flex flex-col gap-gp-sm">
        <div>
          <Button label={botaoLabel} variant="soft" onClick={onAdicionar} />
        </div>

        {rows.length === 0 ? (
          <small className="text-fg-muted">{vazio}</small>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            getRowId={(r) => r.fieldId}
            toolbar={{ enableSearch: false, enableFilters: false }}
            paginationConfig={{ enabled: true, initialPageSize: 10 }}
            cardBreakpoint={false}
          />
        )}
      </div>
      {children}
    </fieldset>
  );
}
