import { useState } from 'react';
import { Modal } from '../../shared/ui/Modal';
import type { ComposicaoItemDto } from '@apollo/shared';
import { LookupField } from '../../shared/ui/LookupField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';

/**
 * Modal de ADICIONAR/EDITAR um item de COMPOSIÇÃO (kit — F4). Espelha o `CodAuxiliarModal`:
 * form LOCAL e controlado; só ao "Salvar" o item sobe pro pai (append/update no
 * useFieldArray), aparecendo imediatamente no grid. No save do master, o engine de agregado
 * grava master + composições numa transação (a flag `composicao` é derivada server-side).
 *
 * Campos (ComposicaoItemDto): idproduto_01 (componente — outro produto, lookup), qtde
 * (NumberField), valor (custo unitário — CurrencyField). A validação de formato é do
 * `composicaoItemSchema`/`produtoSchema` no submit.
 */
const COMPOSICAO_VAZIO: ComposicaoItemDto = { qtde: 0, valor: 0 };

interface Props {
  /** item a EDITAR (vem do field array) ou undefined p/ ADICIONAR um novo. */
  inicial?: ComposicaoItemDto;
  /** lookup de produtos (idproduto → "codbarra - descrição"). */
  onFechar: () => void;
  /** devolve o item pronto ao pai (que faz append/update no useFieldArray). */
  onConfirmar: (item: ComposicaoItemDto) => void;
}

export function ComposicaoModal({ inicial, onFechar, onConfirmar }: Props) {
  const [item, setItem] = useState<ComposicaoItemDto>(inicial ?? COMPOSICAO_VAZIO);
  const set = <K extends keyof ComposicaoItemDto>(k: K, v: ComposicaoItemDto[K]) =>
    setItem((i) => ({ ...i, [k]: v }));

  return (
    <Modal
      open
      onClose={onFechar}
      size="md"
      title={inicial ? 'Editar componente do kit' : 'Adicionar componente do kit'}
      primaryAction={{ label: 'Salvar', onClick: () => onConfirmar(item) }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
        <div className="sm:col-span-2">
          {/* UCadProduto.pas:1795/1942/1969 — no legado o Adicionar abre a Pesquisa da GET_PRODUTOS_ESTOQUE da loja com MULTISSELEÇÃO
              (vários de uma vez, abrindo em DESCRICAO "começado com"); aqui, um por vez, sem o teto de 200 do combo (a multisseleção é o
              corte D da Pesquisa) */}
          <LookupField
            label="&Produto (componente)"
            recurso="lookup/produtos"
            campoCodigo="idproduto"
            campoDigitado="codbarra"
            descricao="descricao"
            value={item.idproduto_01 ?? undefined}
            onChange={(cod) => set('idproduto_01', cod ? Number(cod) : undefined)}
          />
        </div>
        <NumberField
          label="&Quantidade"
          value={item.qtde}
          onChange={(v) => set('qtde', v ?? 0)}
          decimais={3}
          min={0}
        />
        <CurrencyField label="&Valor" value={item.valor} onChange={(v) => set('valor', v ?? 0)} />
      </div>
    </Modal>
  );
}
