import { useState } from 'react';
import { Modal } from '@apollosg/design-system';
import { ORIGEM_OPCOES, type NfItemDto } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import type { Opcao } from '../../shared/cadmaster/useResourceOptions';

/**
 * Modal de ADICIONAR/EDITAR um ITEM da NF (detalhe 1:N — NF_PROD). Espelha o padrão dos
 * modais de detalhe (CodAuxiliarModal/EnderecoModal): form LOCAL controlado; só ao "Salvar"
 * o item sobe ao pai (append/update no useFieldArray) e aparece no grid. No save do master,
 * o engine de agregado grava header + itens numa transação.
 *
 * F1 = a tela ARMAZENA a config fiscal por item (CFOP/CST/alíquota/origem/NCM/CEST); o
 * CÁLCULO de imposto (bases/valores) é F2 (reusa `precificacao`). Por isso o modal coleta o
 * que o operador digita; produto e quantidade são obrigatórios (item sem produto/qtde é
 * rejeitado no schema). Validação de formato/obrigatórios é do `nfSchema` no submit.
 */
const ITEM_VAZIO: NfItemDto = { codproduto: undefined as unknown as number, quantidade: undefined as unknown as number };

interface Props {
  /** item a EDITAR (do field array) ou undefined p/ ADICIONAR. */
  inicial?: NfItemDto;
  produtoOptions: Opcao[];
  cfopOptions: Opcao[];
  aliquotaOptions: Opcao[];
  unidadeOptions: Opcao[];
  onFechar: () => void;
  onConfirmar: (item: NfItemDto) => void;
}

export function NfItemModal({
  inicial,
  produtoOptions,
  cfopOptions,
  aliquotaOptions,
  unidadeOptions,
  onFechar,
  onConfirmar,
}: Props) {
  const [item, setItem] = useState<NfItemDto>(inicial ?? ITEM_VAZIO);
  const [erro, setErro] = useState<string | undefined>();
  const set = <K extends keyof NfItemDto>(k: K, v: NfItemDto[K]) => setItem((i) => ({ ...i, [k]: v }));

  const salvar = () => {
    if (item.codproduto == null) return setErro('Informe o produto do item.');
    if (!(Number(item.quantidade) > 0)) return setErro('A quantidade deve ser maior que zero.');
    onConfirmar(item);
  };

  return (
    <Modal
      open
      onClose={onFechar}
      size="lg"
      title={inicial ? 'Editar item da nota' : 'Adicionar item da nota'}
      primaryAction={{ label: 'Salvar', onClick: salvar }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-form-gap">
        {erro && <small className="text-fg-danger">{erro}</small>}
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <div className="sm:col-span-2">
            <SelectField
              label="&Produto"
              options={produtoOptions}
              value={item.codproduto != null ? String(item.codproduto) : undefined}
              onChange={(v) => set('codproduto', v ? Number(v) : (undefined as unknown as number))}
              placeholder="Selecione o produto…"
            />
          </div>
          <NumberField
            label="&Quantidade"
            value={item.quantidade as number | undefined}
            onChange={(v) => set('quantidade', v as number)}
            decimais={3}
            min={0}
          />
          <NumberField
            label="&Fator embalagem"
            value={item.fatorembal}
            onChange={(v) => set('fatorembal', v)}
            decimais={3}
            min={0}
          />
          <SelectField
            label="&Unidade"
            options={unidadeOptions}
            value={item.unidade ?? undefined}
            onChange={(v) => set('unidade', v || undefined)}
            placeholder="Selecione…"
          />
          <CurrencyField
            label="&Valor unitário"
            value={item.vrvenda}
            onChange={(v) => set('vrvenda', v)}
          />
          <CurrencyField label="&Desconto" value={item.desconto} onChange={(v) => set('desconto', v)} />
          <CurrencyField label="&Bonificação" value={item.bonificacao} onChange={(v) => set('bonificacao', v)} />
        </div>

        {/* Config fiscal ARMAZENADA (cálculo de imposto = F2). */}
        <fieldset className="rounded-radius-base border border-border p-pad-sm">
          <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Fiscal</legend>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <SelectField
              label="&CFOP"
              options={cfopOptions}
              value={item.cfop ?? undefined}
              onChange={(v) => set('cfop', v || undefined)}
              placeholder="Selecione o CFOP…"
            />
            <SelectField
              label="A&líquota"
              options={aliquotaOptions}
              value={item.aliquota ?? undefined}
              onChange={(v) => set('aliquota', v || undefined)}
              placeholder="Selecione a alíquota…"
            />
            <Field
              label="&NCM"
              inputMode="numeric"
              maxLength={8}
              value={item.ncm ?? ''}
              onChange={(e) => set('ncm', e.target.value || undefined)}
            />
            <Field
              label="C&EST"
              inputMode="numeric"
              maxLength={7}
              value={item.cest ?? ''}
              onChange={(e) => set('cest', e.target.value || undefined)}
            />
            <NumberField
              label="&ICMS (%)"
              value={item.icms}
              onChange={(v) => set('icms', v)}
              decimais={2}
              min={0}
              endAddon="%"
            />
            <NumberField
              label="C&ST"
              value={item.cst}
              onChange={(v) => set('cst', v)}
              decimais={0}
              min={0}
            />
            <Field
              label="CSOS&N"
              maxLength={3}
              value={item.csosn ?? ''}
              onChange={(e) => set('csosn', e.target.value || undefined)}
            />
            <SelectField
              label="&Origem"
              options={ORIGEM_OPCOES}
              value={item.origem_estoque ?? undefined}
              onChange={(v) => set('origem_estoque', v || undefined)}
              placeholder="Selecione a origem…"
            />
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
