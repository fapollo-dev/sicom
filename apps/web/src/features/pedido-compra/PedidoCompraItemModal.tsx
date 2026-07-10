import { useState } from 'react';
import { Modal } from '@apollosg/design-system';
import type { PedidoCompraItemDto } from '@apollo/shared';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { TextArea } from '../../shared/ui/TextArea';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import type { Opcao } from '../../shared/cadmaster/useResourceOptions';
import { useMensagem } from '../../shared/mensagem';
import { precificarProduto } from '../produtos/precificacaoApi';

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
  /** idproduto → alíquota-código (para o motor de preço formar a venda a partir do custo). */
  produtoAliquotas: Record<string, string>;
  onFechar: () => void;
  onConfirmar: (item: PedidoCompraItemDto) => void;
}

export function PedidoCompraItemModal({ inicial, produtoOptions, produtoAliquotas, onFechar, onConfirmar }: Props) {
  const mensagem = useMensagem();
  const [item, setItem] = useState<PedidoCompraItemDto>(inicial ?? ITEM_VAZIO);
  const [erro, setErro] = useState<string | undefined>();
  const [uf, setUf] = useState('SP'); // UF do cálculo (default; a UF real virá da EMPRESA — mesmo limite da tela de Produto)
  const [calculando, setCalculando] = useState(false);
  const set = <K extends keyof PedidoCompraItemDto>(k: K, v: PedidoCompraItemDto[K]) =>
    setItem((i) => ({ ...i, [k]: v }));

  // VLREMBALAGEM (custo estendido) = quantidade × custo — só exibição; o servidor recomputa.
  const vlrembalagem = (Number(item.fatorembalagem) || 0) * (Number(item.vrcusto) || 0);

  /** o comprador FORMA o preço: reusa o motor (POST /precificacao/produto) — custo + markup → venda/margem/PMZ. */
  const precificar = async () => {
    if (calculando) return;
    if (item.idproduto == null) return setErro('Selecione o produto antes de precificar.');
    if (!(Number(item.vrcusto) >= 0)) return setErro('Informe o custo antes de precificar.');
    const aliquota = (produtoAliquotas[String(item.idproduto)] ?? '').trim();
    if (!aliquota) return setErro('Produto sem alíquota fiscal cadastrada — não é possível precificar.');
    setCalculando(true);
    setErro(undefined);
    try {
      const r = await precificarProduto({
        custo: Number(item.vrcusto) || 0,
        margem: Number(item.markup) || 0,
        aliquota,
        uf: uf.trim().toUpperCase(),
        pis: 0,
        cofins: 0,
        regime: 'atual',
      });
      setItem((i) => ({
        ...i,
        vrcustoliquido: r.custoLiquido,
        vrvendasug: r.valorVenda, // SUGESTÃO do motor (DbtVendaSugestao)
        // PRATICADO: default = sugestão, mas preserva um valor já digitado pelo comprador (≠ sugerido no legado).
        vrvenda: Number(i.vrvenda) > 0 ? i.vrvenda : r.valorVenda,
        margeml2: r.margemLiquida,
        margeml2v: r.lucroLiquido,
        pmz: r.pmz,
      }));
      mensagem.sucesso(`Venda sugerida R$ ${r.valorVenda.toFixed(2)} · PMZ R$ ${r.pmz.toFixed(2)} · margem líq. ${r.margemLiquida.toFixed(2)}%.`);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCalculando(false);
    }
  };

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

        {/* Precificação do item (o comprador FORMA o preço) — reuso do motor /precificacao/produto. */}
        <fieldset className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Precificação (forma o preço de venda)</legend>
          <div className="grid grid-cols-2 gap-form-gap sm:grid-cols-4">
            <NumberField label="&Markup" value={item.markup as number | undefined} onChange={(v) => set('markup', v)} decimais={2} min={0} endAddon="%" />
            <CurrencyField label="&Venda (praticada)" value={item.vrvenda as number | undefined} onChange={(v) => set('vrvenda', v)} />
            <NumberField label="Margem &líq. (L2)" value={item.margeml2 as number | undefined} onChange={(v) => set('margeml2', v)} decimais={2} endAddon="%" />
            <div className="w-24">
              <Field label="&UF" value={uf} maxLength={2} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} />
            </div>
          </div>
          <div className="mt-form-gap flex flex-wrap items-center gap-gp-sm">
            <Button label="&Calcular venda" variant="soft" onClick={() => void precificar()} />
            {(item.pmz != null || item.vrcustoliquido != null || item.vrvendasug != null) && (
              <small className="text-fg-muted tabular-nums">
                Custo líq. R$ {fmtBRL(Number(item.vrcustoliquido) || 0)} · Venda sugerida R$ {fmtBRL(Number(item.vrvendasug) || 0)} · PMZ R$ {fmtBRL(Number(item.pmz) || 0)}
              </small>
            )}
          </div>
        </fieldset>
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
