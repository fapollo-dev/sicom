import { useMemo, useState } from 'react';
import { Controller, useFieldArray, type UseFormReturn } from 'react-hook-form';
import { Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumnDef } from '@apollosg/design-system';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { SelectField } from '../../shared/ui/SelectField';
import { DateField } from '../../shared/ui/DateField';
import { Button } from '../../shared/ui/Button';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { loteCobrancaSchema, type CriarLoteCobrancaDto } from '@apollo/shared';
import { AddTitulosModal } from './AddTitulosModal';
import type { AreceberRow, ItemLote } from './lotesCobrancaApi';

/** hoje em ISO 'YYYY-MM-DD' (legado DefaultToday=True no campo Emissão). */
const hojeISO = () => new Date().toISOString().slice(0, 10);

/**
 * Form local = o DTO + colunas de EXIBIÇÃO nos itens (duplicata/razao/dtvenc/valor/
 * juros/total). Só `codrcb` é persistido — o zod do schema (z.object) descarta as
 * chaves desconhecidas no submit, então o display fica apenas no estado do form/grid.
 */
type LoteForm = Omit<CriarLoteCobrancaDto, 'itens'> & { itens: ItemLote[] };

/**
 * Lote de Cobrança (legado `UCadLoteCobranca.pas/.dfm`) — MESTRE-DETALHE legado-fiel
 * sobre o pilar `<CadMaster>`. O master traz o "Cobrador" (LOOKUP de parceiros FUN='S',
 * mostra a RAZAO) e a "Emissão" (data, default hoje). O detalhe deixa de ser um input
 * cru de `codrcb`: vira uma PESQUISA multi-seleção de títulos a receber (Modal+DataTable)
 * + um GRID read-only com as colunas joinadas. Gravação/cascata/transação vêm do
 * AggregateEngineService (uma só chamada de save).
 */
export function LotesCobrancaCadMaster() {
  // LOOKUP/FK do Cobrador — parceiros FUN='S' (mostra "cod - razão", não o id cru).
  const { data: cobradorOptions = [] } = useResourceOptions('cobranca/cobradores', (c: any) => ({
    value: String(c.codparceiro),
    label: `${c.codparceiro} - ${c.razao}`,
  }));

  return (
    <CadMaster<LoteForm>
      titulo="Lote de Cobrança"
      resourcePath="cobranca/lotes-md"
      pk="codlotecob"
      schema={loteCobrancaSchema}
      defaultValues={{ codparceiro: undefined, data: hojeISO(), itens: [] }}
      colunasPesquisa={[
        { campo: 'codlotecob', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'codparceiro', label: 'Cobrador', tipo: 'text' },
        { campo: 'razao', label: 'Razão', tipo: 'text' },
        { campo: 'data', label: 'Emissão', tipo: 'date', largura: 130 },
      ]}
      campos={({ form, editavel }) => (
        <div className="flex flex-col gap-form-gap">
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <Controller
              control={form.control}
              name="codparceiro"
              render={({ field }) => (
                <SelectField
                  label="&Cobrador"
                  options={cobradorOptions}
                  value={field.value != null ? String(field.value) : undefined}
                  onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                  placeholder="Selecione o cobrador…"
                  error={form.formState.errors.codparceiro?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="data"
              render={({ field }) => (
                <DateField
                  label="&Emissão"
                  value={(field.value as string) || undefined}
                  onChange={(v) => field.onChange(v ?? '')}
                  disabled={!editavel}
                  error={form.formState.errors.data?.message as string | undefined}
                />
              )}
            />
          </div>

          <ItensSection form={form} editavel={editavel} />
        </div>
      )}
    />
  );
}

/**
 * Detalhe (ITENS_LOTECOB) — GRID read-only das colunas joinadas + botão que abre o
 * picker de títulos. Append faz dedupe por `codrcb` (entre o que já está no lote e a
 * própria seleção). Itens carregados (read enriquecido) e itens recém-adicionados
 * (vindos do picker) compartilham o mesmo shape `ItemLote`, então o grid os exibe de
 * forma idêntica — antes mesmo de gravar.
 */
function ItensSection({
  form,
  editavel,
}: {
  form: UseFormReturn<LoteForm>;
  editavel: boolean;
}) {
  const { fields, append, remove } = useFieldArray<LoteForm, 'itens', 'fieldId'>({
    control: form.control,
    name: 'itens',
    keyName: 'fieldId',
  });
  const [pickerAberto, setPickerAberto] = useState(false);

  // codlotecob corrente (read enriquecido) — só ao EDITAR, p/ excluir os já no lote
  const codlotecob = (form.getValues() as any)?.codlotecob as number | undefined;
  const jaSelecionados = fields.map((f) => f.codrcb).filter((n): n is number => n != null);

  const onConfirmar = (rows: AreceberRow[]) => {
    const existentes = new Set(jaSelecionados);
    for (const r of rows) {
      if (existentes.has(r.codrcb)) continue; // dedupe por codrcb
      existentes.add(r.codrcb);
      append({
        codrcb: r.codrcb,
        duplicata: r.duplicata,
        razao: r.razao,
        dtvenc: r.dtvenc,
        valor: r.valor,
        juros: r.juros,
        total: r.total,
      });
    }
    setPickerAberto(false);
  };

  // colunas do grid — read-only; currency/date formatam via registry do DataTable.
  const columns = useMemo<DataTableColumnDef<ItemLote & { fieldId: string }>[]>(
    () => [
      { field: 'codrcb', headerName: 'Código', type: 'number', width: 100 },
      { field: 'duplicata', headerName: 'Duplicata', type: 'text', width: 130 },
      { field: 'razao', headerName: 'Cliente', type: 'text', isPrimary: true },
      { field: 'dtvenc', headerName: 'Vencimento', type: 'date', width: 130 },
      { field: 'valor', headerName: 'Valor', type: 'currency', width: 130 },
      { field: 'juros', headerName: 'Juros', type: 'currency', width: 120 },
      { field: 'total', headerName: 'Total', type: 'currency', width: 130 },
      {
        field: 'acoes',
        headerName: '',
        type: 'actions',
        width: 80,
        getActions: ({ row }) => [
          {
            id: 'remover',
            label: 'Remover',
            icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            destructive: true,
            onClick: (r) => {
              const idx = fields.findIndex((f) => f.fieldId === (r as any).fieldId);
              if (idx >= 0) remove(idx);
            },
          },
        ],
      },
    ],
    [fields, remove],
  );

  return (
    <fieldset
      disabled={!editavel}
      className="rounded-radius-base border border-border p-pad-md"
    >
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">
        Itens (títulos a receber)
      </legend>
      <div className="flex flex-col gap-gp-sm">
        <div>
          <Button
            label="Adicionar &títulos"
            variant="soft"
            onClick={() => setPickerAberto(true)}
          />
        </div>

        {fields.length === 0 ? (
          <small className="text-fg-muted">Sem títulos no lote.</small>
        ) : (
          <DataTable
            rows={fields as Array<ItemLote & { fieldId: string }>}
            columns={columns}
            getRowId={(r) => r.fieldId}
            toolbar={{ enableSearch: false, enableFilters: false }}
            paginationConfig={{ enabled: true, initialPageSize: 10 }}
            cardBreakpoint={false}
          />
        )}
      </div>

      {pickerAberto && (
        <AddTitulosModal
          excluirDoLote={codlotecob}
          jaSelecionados={jaSelecionados}
          onFechar={() => setPickerAberto(false)}
          onConfirmar={onConfirmar}
        />
      )}
    </fieldset>
  );
}
