import { type ReactNode } from 'react';
import {
  useFieldArray,
  type FieldValues,
  type UseFormReturn,
  type ArrayPath,
} from 'react-hook-form';
import type { ZodSchema } from 'zod';
import { CadMaster } from './CadMaster';
import type { ColunaPesquisa } from './Pesquisa';
import { Button } from '../ui/Button';

interface CamposCtx<T extends FieldValues> {
  form: UseFormReturn<T>;
  editavel: boolean;
}
interface ItemCtx<T extends FieldValues> extends CamposCtx<T> {
  index: number;
}

interface DetalheSpec<T extends FieldValues> {
  /** propriedade no form que carrega o array de itens (ex.: 'itens') */
  chave: ArrayPath<T> & string;
  /** rótulo da seção de itens */
  titulo: string;
  /** fábrica de um item novo (valores default da linha) */
  novoItem: () => any;
  /** render dos campos de UMA linha (recebe index + form + editável) */
  itemCampos: (ctx: ItemCtx<T>) => ReactNode;
}

interface Props<T extends FieldValues> {
  titulo: string;
  resourcePath: string;
  pk: string;
  schema: ZodSchema;
  defaultValues?: any;
  colunasPesquisa?: ColunaPesquisa[];
  viewPk?: string;
  pkGerada?: boolean;
  /** campos do HEADER (master) */
  campos: (ctx: CamposCtx<T>) => ReactNode;
  /** o detalhe (itens) — espelha o ClientDataSet de detalhe do TfrmCadMasterDet */
  detalhe: DetalheSpec<T>;
}

/**
 * Shell MESTRE-DETALHE — `TfrmCadMasterDet` em React. COMPÕE o `<CadMaster>`
 * (estado, código+Enter, navegação, Pesquisa, rodapé, sync herdados) e injeta um
 * GRID de itens (useFieldArray) nos campos. O agregado (header + itens) trafega no
 * mesmo form → uma chamada de gravação (transação atômica no AggregateEngineService).
 */
export function CadMasterDet<T extends FieldValues>({ detalhe, campos, ...rest }: Props<T>) {
  return (
    <CadMaster<T>
      {...rest}
      campos={(ctx) => (
        <>
          {campos(ctx)}
          <DetalheGrid<T> spec={detalhe} form={ctx.form} editavel={ctx.editavel} />
        </>
      )}
    />
  );
}

function DetalheGrid<T extends FieldValues>({
  spec,
  form,
  editavel,
}: {
  spec: DetalheSpec<T>;
  form: UseFormReturn<T>;
  editavel: boolean;
}) {
  const { fields, append, remove } = useFieldArray<T>({ control: form.control, name: spec.chave });
  return (
    <fieldset disabled={!editavel} style={{ border: '1px solid #eee', borderRadius: 6, padding: 12, marginTop: 16 }}>
      <legend style={{ padding: '0 6px', fontWeight: 600 }}>{spec.titulo}</legend>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {fields.length === 0 && <small style={{ color: '#888' }}>Sem itens.</small>}
        {fields.map((f, index) => (
          <div key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>{spec.itemCampos({ form, editavel, index })}</div>
            <Button label="Remover" variant="ghost" onClick={() => remove(index)} />
          </div>
        ))}
        <div>
          <Button label="&Adicionar item" variant="soft" onClick={() => append(spec.novoItem())} />
        </div>
      </div>
    </fieldset>
  );
}
