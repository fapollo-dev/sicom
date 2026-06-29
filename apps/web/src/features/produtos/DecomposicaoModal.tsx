import { useState } from 'react';
import { Modal } from '@apollosg/design-system';
import type { DecomposicaoItemDto } from '@apollo/shared';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import type { Opcao } from '../../shared/cadmaster/useResourceOptions';

/**
 * Modal de ADICIONAR/EDITAR um item de DECOMPOSIÇÃO (1 produto → vários — F4). Espelha o
 * `CodAuxiliarModal`: form LOCAL e controlado; só ao "Salvar" o item sobe pro pai
 * (append/update no useFieldArray). A flag `decomposicao` é derivada server-side da presença
 * de itens; a regra "deve somar 100%" é validada pelo back no save (envelope VALIDACAO PT).
 *
 * Campos (DecomposicaoItemDto): idproduto_01 (resultante — outro produto, lookup) e percentual
 * (NumberField, 2 casas). A validação de formato é do `decomposicaoItemSchema` no submit.
 */
const DECOMPOSICAO_VAZIO: DecomposicaoItemDto = { percentual: 0 };

interface Props {
  /** item a EDITAR (vem do field array) ou undefined p/ ADICIONAR um novo. */
  inicial?: DecomposicaoItemDto;
  /** lookup de produtos (idproduto → "codbarra - descrição"). */
  produtoOptions: Opcao[];
  onFechar: () => void;
  /** devolve o item pronto ao pai (que faz append/update no useFieldArray). */
  onConfirmar: (item: DecomposicaoItemDto) => void;
}

export function DecomposicaoModal({ inicial, produtoOptions, onFechar, onConfirmar }: Props) {
  const [item, setItem] = useState<DecomposicaoItemDto>(inicial ?? DECOMPOSICAO_VAZIO);
  const set = <K extends keyof DecomposicaoItemDto>(k: K, v: DecomposicaoItemDto[K]) =>
    setItem((i) => ({ ...i, [k]: v }));

  return (
    <Modal
      open
      onClose={onFechar}
      size="md"
      title={inicial ? 'Editar item da decomposição' : 'Adicionar item da decomposição'}
      primaryAction={{ label: 'Salvar', onClick: () => onConfirmar(item) }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
        <div className="sm:col-span-2">
          <SelectField
            label="&Produto (resultante)"
            options={produtoOptions}
            value={item.idproduto_01 != null ? String(item.idproduto_01) : undefined}
            onChange={(v) => set('idproduto_01', v ? Number(v) : undefined)}
            placeholder="Selecione o produto…"
          />
        </div>
        <NumberField
          label="&Percentual"
          value={item.percentual}
          onChange={(v) => set('percentual', v ?? 0)}
          decimais={2}
          min={0}
          max={100}
          endAddon="%"
        />
      </div>
    </Modal>
  );
}
