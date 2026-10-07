import { useState } from 'react';
import { Modal } from '../../shared/ui/Modal';
import type { ReceitaItemDto } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { LookupField } from '../../shared/ui/LookupField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';

/**
 * Modal de ADICIONAR/EDITAR um item de RECEITA (ficha técnica — F4). Espelha o
 * `CodAuxiliarModal`: form LOCAL e controlado; só ao "Salvar" o item sobe pro pai
 * (append/update no useFieldArray). A flag `receita` é derivada server-side da presença de
 * itens; o engine de agregado grava master + receitas numa transação.
 *
 * Campos (ReceitaItemDto): idproduto_receita (ingrediente — outro produto, lookup), qtde
 * (NumberField), unidade (Field, 2 chars), valor (CurrencyField) e fatorcxprod (fator cx,
 * NumberField, opcional). A validação de formato é do `receitaItemSchema` no submit.
 */
const RECEITA_VAZIO: ReceitaItemDto = { qtde: 0, valor: 0, fatorcxprod: 0 };

interface Props {
  /** item a EDITAR (vem do field array) ou undefined p/ ADICIONAR um novo. */
  inicial?: ReceitaItemDto;
  /** lookup de produtos (idproduto → "codbarra - descrição"). */
  onFechar: () => void;
  /** devolve o item pronto ao pai (que faz append/update no useFieldArray). */
  onConfirmar: (item: ReceitaItemDto) => void;
}

export function ReceitaModal({ inicial, onFechar, onConfirmar }: Props) {
  const [item, setItem] = useState<ReceitaItemDto>(inicial ?? RECEITA_VAZIO);
  const set = <K extends keyof ReceitaItemDto>(k: K, v: ReceitaItemDto[K]) =>
    setItem((i) => ({ ...i, [k]: v }));

  return (
    <Modal
      open
      onClose={onFechar}
      size="md"
      title={inicial ? 'Editar ingrediente da receita' : 'Adicionar ingrediente da receita'}
      primaryAction={{ label: 'Salvar', onClick: () => onConfirmar(item) }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
        <div className="sm:col-span-2">
          {/* UCadProduto.pas:1795/1942/1969 — no legado o Adicionar abre a Pesquisa da GET_PRODUTOS_ESTOQUE da loja com MULTISSELEÇÃO
              (vários de uma vez, abrindo em DESCRICAO "começado com"); aqui, um por vez, sem o teto de 200 do combo (a multisseleção é o
              corte D da Pesquisa) */}
          <LookupField
            label="&Ingrediente"
            recurso="lookup/produtos"
            campoCodigo="idproduto"
            campoDigitado="codbarra"
            descricao="descricao"
            value={item.idproduto_receita ?? undefined}
            onChange={(cod) => set('idproduto_receita', cod ? Number(cod) : undefined)}
          />
        </div>
        <NumberField
          label="&Quantidade"
          value={item.qtde}
          onChange={(v) => set('qtde', v ?? 0)}
          decimais={3}
          min={0}
        />
        <Field
          label="&Unidade"
          value={item.unidade ?? ''}
          maxLength={2}
          onChange={(e) => set('unidade', e.target.value.toUpperCase().slice(0, 2) || undefined)}
        />
        <CurrencyField label="&Valor" value={item.valor} onChange={(v) => set('valor', v ?? 0)} />
        <NumberField
          label="&Fator caixa"
          value={item.fatorcxprod}
          onChange={(v) => set('fatorcxprod', v ?? 0)}
          decimais={3}
          min={0}
        />
      </div>
    </Modal>
  );
}
