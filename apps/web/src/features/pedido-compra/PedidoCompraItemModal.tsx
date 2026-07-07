import { useState } from 'react';
import { Modal } from '@apollosg/design-system';
import type { PedidoCompraItemDto } from '@apollo/shared';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { TextArea } from '../../shared/ui/TextArea';
import type { Opcao } from '../../shared/cadmaster/useResourceOptions';

/**
 * Modal de ADICIONAR/EDITAR um ITEM do pedido de compra (detalhe 1:N — PEDIDOCOMPRA_I). Espelha o
 * NfItemModal, porém MUITO mais simples: produto + quantidade (FATOREMBALAGEM) + custo unitário
 * negociado (VRCUSTO) + descontos + obs. VLREMBALAGEM (= qtd × custo) é DERIVADO no servidor — aqui
 * é só exibido em leitura enquanto edita. Form LOCAL; só ao "Salvar" o item sobe ao pai (useFieldArray).
 */
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ITEM_VAZIO: PedidoCompraItemDto = {
  idproduto: undefined as unknown as number,
  fatorembalagem: undefined as unknown as number,
  vrcusto: undefined as unknown as number,
};

interface Props {
  /** item a EDITAR (do field array) ou undefined p/ ADICIONAR. */
  inicial?: PedidoCompraItemDto;
  produtoOptions: Opcao[];
  onFechar: () => void;
  onConfirmar: (item: PedidoCompraItemDto) => void;
}

export function PedidoCompraItemModal({ inicial, produtoOptions, onFechar, onConfirmar }: Props) {
  const [item, setItem] = useState<PedidoCompraItemDto>(inicial ?? ITEM_VAZIO);
  const [erro, setErro] = useState<string | undefined>();
  const set = <K extends keyof PedidoCompraItemDto>(k: K, v: PedidoCompraItemDto[K]) =>
    setItem((i) => ({ ...i, [k]: v }));

  // VLREMBALAGEM (custo estendido) = quantidade × custo — só exibição; o servidor recomputa.
  const vlrembalagem = (Number(item.fatorembalagem) || 0) * (Number(item.vrcusto) || 0);

  const salvar = () => {
    if (item.idproduto == null) return setErro('Informe o produto do item.');
    if (!(Number(item.fatorembalagem) > 0)) return setErro('A quantidade deve ser maior que zero.');
    if (!(Number(item.vrcusto) >= 0)) return setErro('Custo inválido.');
    onConfirmar(item);
  };

  return (
    <Modal
      open
      onClose={onFechar}
      size="lg"
      title={inicial ? 'Editar item do pedido' : 'Adicionar item do pedido'}
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
              value={item.idproduto != null ? String(item.idproduto) : undefined}
              onChange={(v) => set('idproduto', v ? Number(v) : (undefined as unknown as number))}
              placeholder="Selecione o produto…"
            />
          </div>
          <NumberField
            label="&Quantidade"
            value={item.fatorembalagem as number | undefined}
            onChange={(v) => set('fatorembalagem', v as number)}
            decimais={3}
            min={0}
          />
          <CurrencyField
            label="&Custo unit."
            value={item.vrcusto as number | undefined}
            onChange={(v) => set('vrcusto', v as number)}
          />
          <CurrencyField label="&Desconto" value={item.desconto as number | undefined} onChange={(v) => set('desconto', v)} />
          <NumberField
            label="Desconto (&%)"
            value={item.descontop as number | undefined}
            onChange={(v) => set('descontop', v)}
            decimais={2}
            min={0}
            max={100}
            endAddon="%"
          />
          <div className="sm:col-span-2">
            <TextArea
              label="&Observação"
              rows={2}
              value={(item.obs as string | undefined) ?? ''}
              onChange={(e) => set('obs', e.target.value || undefined)}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-gp-sm border-t border-border pt-pad-sm">
          <span className="text-body-sm text-fg-muted">Total do item (qtd × custo)</span>
          <span className="rounded-radius-base bg-bg-subtle px-pad-sm py-pad-xs text-body-sm font-semibold text-fg-default tabular-nums">
            R$ {fmtBRL(vlrembalagem)}
          </span>
        </div>
      </div>
    </Modal>
  );
}
