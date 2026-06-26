import { useMemo, useState } from 'react';
import { type UseFormReturn, useFieldArray } from 'react-hook-form';
import { Pencil, Trash2 } from 'lucide-react';
import { DataTable, Modal, type DataTableColumnDef } from '@apollosg/design-system';
import {
  type BancoParceiroDto,
  type CriarParceiroDto,
  type PgtoParceiroDto,
  type RelParceiroDto,
  type VendedorParceiroDto,
} from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useResourceOptions, type Opcao } from '../../shared/cadmaster/useResourceOptions';

/**
 * Detalhes 1:N do PARCEIRO (Fase 2) — espelham o grid de Endereços (ParceirosCadMaster):
 * cada seção é um <fieldset> com DataTable + Adicionar/Editar/Remover via `useFieldArray`,
 * e um Modal LOCAL de ADICIONAR/EDITAR um item. Itens recém-adicionados aparecem na hora;
 * no save, o engine de agregado grava master + todos os detalhes numa transação.
 *
 * São 4: Bancos (PARCEIROS_BANCOS), Formas de pagamento (PARCEIROS_PGTO), Relacionamentos
 * (PARCEIROS_REL) e Vendedores (PARCEIROS_VENDEDORES).
 */

/** célula utilitária: resolve o label de uma opção a partir do value (lookup → "cod - nome"). */
function rotuloOpcao(options: Opcao[], value: number | undefined): string {
  if (value == null) return '';
  const o = options.find((op) => op.value === String(value));
  return o ? o.label : String(value);
}

// ───────────────────────────── Bancos ─────────────────────────────

/**
 * Dados bancários (PARCEIROS_BANCOS). Banco via lookup `cadastro/bancos` (codbco → "cod - banco");
 * agência e nº conta são texto. Modal local com SelectField (banco) + Field (agência/conta).
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

  // LOOKUP banco — o view get_bancos expõe a PK ora como codbco, ora como codigo.
  const { data: bancoOptions = [] } = useResourceOptions('cadastro/bancos', (row: any) => ({
    value: String(row.codbco ?? row.codigo),
    label: `${row.codbco ?? row.codigo} - ${row.banco}`,
  }));

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
        valueGetter: (row) => rotuloOpcao(bancoOptions, row.codbco),
      },
      { field: 'agencia', headerName: 'Agência', type: 'text', width: 150 },
      { field: 'nrconta', headerName: 'Nº conta', type: 'text', width: 180 },
      acoesColumn(fields, setEditIdx, remove),
    ],
    [fields, remove, bancoOptions],
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
          bancoOptions={bancoOptions}
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
  bancoOptions,
  onFechar,
  onConfirmar,
}: {
  inicial?: BancoParceiroDto;
  bancoOptions: Opcao[];
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
        <div className="sm:col-span-2">
          <SelectField
            label="&Banco"
            options={bancoOptions}
            value={item.codbco != null ? String(item.codbco) : undefined}
            onChange={(v) => set('codbco', v ? Number(v) : undefined)}
            placeholder="Selecione o banco…"
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
 * Vendedores vinculados (PARCEIROS_VENDEDORES). codvendedor via lookup `cadastro/parceiros`
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

  // LOOKUP vendedor = parceiro FUN='S' (3º arg de filtro), mostra "cod - razão".
  const { data: vendedorOptions = [] } = useResourceOptions(
    'cadastro/parceiros',
    (p: any) => ({ value: String(p.codparceiro), label: `${p.codparceiro} - ${p.razao}` }),
    { campo: 'fun', operador: 'igual', valor: 'S' },
  );

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
        valueGetter: (row) => rotuloOpcao(vendedorOptions, row.codvendedor),
      },
      acoesColumn(fields, setEditIdx, remove),
    ],
    [fields, remove, vendedorOptions],
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
          vendedorOptions={vendedorOptions}
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
  vendedorOptions,
  onFechar,
  onConfirmar,
}: {
  inicial?: VendedorParceiroDto;
  vendedorOptions: Opcao[];
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
      <SelectField
        label="&Vendedor"
        options={vendedorOptions}
        value={item.codvendedor != null ? String(item.codvendedor) : undefined}
        onChange={(v) => setItem({ codvendedor: v ? Number(v) : undefined })}
        placeholder="Selecione o vendedor…"
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
