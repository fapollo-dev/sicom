import { useState } from 'react';
import { Modal } from '@apollosg/design-system';
import type { PedidoCompraItemDto } from '@apollo/shared';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { TextArea } from '../../shared/ui/TextArea';
import { Button } from '../../shared/ui/Button';
import type { Opcao } from '../../shared/cadmaster/useResourceOptions';
import { useMensagem } from '../../shared/mensagem';
import { herdarItemPedido, precificarItemPedido } from './pedidoCompraApi';

/**
 * Modal de ADICIONAR/EDITAR um ITEM do pedido de compra (detalhe 1:N — PEDIDOCOMPRA_I). Espelha o
 * NfItemModal, porém MUITO mais simples: produto + quantidade (FATOREMBALAGEM) + custo unitário
 * negociado (VRCUSTO) + descontos + obs. VLREMBALAGEM (= qtd × custo) é DERIVADO no servidor — aqui
 * é só exibido em leitura enquanto edita. Form LOCAL; só ao "Salvar" o item sobe ao pai (useFieldArray).
 */
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ITEM_VAZIO: PedidoCompraItemDto = {
  idproduto: undefined as unknown as number,
  qtde: 1, // nº de embalagens (078 FLIP; default 1)
  fatorembalagem: undefined as unknown as number,
  vrcusto: undefined as unknown as number,
};

/** uma loja participante do pedido, com o seu estado (mig 303). */
export interface LojaDoPedido { idempresa: number; fechado: boolean }

interface Props {
  /** item a EDITAR (do field array) ou undefined p/ ADICIONAR. */
  inicial?: PedidoCompraItemDto;
  /** as lojas do pedido: com mais de uma, a quantidade é digitada POR LOJA e a do item é a soma. */
  lojas?: LojaDoPedido[];
  produtoOptions: Opcao[];
  /** idproduto → alíquota-código (legado; o preço do item agora é calculado no servidor). */
  produtoAliquotas?: Record<string, string>;
  /** o fornecedor do pedido — o fator pode vir da referência dele (mig 307) */
  codparceiro?: number | null;
  onFechar: () => void;
  onConfirmar: (item: PedidoCompraItemDto) => void;
}

export function PedidoCompraItemModal({ inicial, lojas = [], produtoOptions, codparceiro, onFechar, onConfirmar }: Props) {
  const mensagem = useMensagem();
  const [item, setItem] = useState<PedidoCompraItemDto>(inicial ?? ITEM_VAZIO);
  // mig 303: pedido de mais de uma loja → a quantidade é POR LOJA (PEDIDO_COMPRA_QTDE); loja fechada não se mexe
  const multiLoja = lojas.length > 1;
  const [porLoja, setPorLoja] = useState<Record<number, number>>(() => {
    const m: Record<number, number> = {};
    for (const l of lojas) m[l.idempresa] = 0;
    for (const l of inicial?.lojas ?? []) m[Number(l.idempresa)] = Number(l.qtde) || 0;
    return m;
  });
  const somaLojas = Object.values(porLoja).reduce((a, b) => a + (Number(b) || 0), 0);
  const [erro, setErro] = useState<string | undefined>();
  const [calculando, setCalculando] = useState(false);
  // mig 307: de onde veio o custo e o fator herdados (para a tela dizer)
  const [origem, setOrigem] = useState<{ custo: string; fator: string } | null>(null);
  const set = <K extends keyof PedidoCompraItemDto>(k: K, v: PedidoCompraItemDto[K]) =>
    setItem((i) => ({ ...i, [k]: v }));

  // Derivados (078 FLIP) — só exibição; o servidor recomputa. VLREMBALAGEM = fator×custo (custo por caixa);
  // TOTALCUSTO = qtde × vlrembalagem (total da linha); QTDTOTAL = qtde × fator (unidades).
  const vlrembalagem = (Number(item.fatorembalagem) || 0) * (Number(item.vrcusto) || 0);
  const totalcusto = (multiLoja ? somaLojas : Number(item.qtde) || 0) * vlrembalagem;

  /**
   * mig 307 — ao escolher o produto, o item HERDA do catálogo da loja (`CarregarItens`, uPedidoCompra.pas:7241): custo
   * (de reposição, com `CUSTO_REP_PC`), fator (do pedido, senão o da caixa), venda, markup, a composição do custo e a
   * escada de preço. Só no item NOVO — editar não troca a foto da compra.
   */
  const escolherProduto = async (v: string | undefined) => {
    const idproduto = v ? Number(v) : (undefined as unknown as number);
    set('idproduto', idproduto);
    setOrigem(null);
    if (!idproduto || inicial) return;
    try {
      const h = await herdarItemPedido(idproduto, codparceiro ?? null);
      const { origem_custo, origem_fator, idproduto: _i, ...campos } = h as Record<string, unknown>;
      setItem((i) => ({ ...i, ...(campos as Partial<PedidoCompraItemDto>), idproduto }));
      setOrigem({
        custo: origem_custo === 'reposicao' ? 'custo de reposição' : 'custo do produto',
        fator: origem_fator === 'fator_pedido' ? 'fator de pedido do produto' : origem_fator === 'referencia_fornecedor' ? 'referência do fornecedor' : 'fator da caixa',
      });
      setErro(undefined);
    } catch (e) {
      mensagem.erro(e);
    }
  };

  /** o PREÇO DO ITEM (o modal `uPrecificacaoProdutos` do legado), calculado no servidor com os parâmetros da loja. */
  const precificar = async () => {
    if (calculando) return;
    if (item.idproduto == null) return setErro('Selecione o produto antes de precificar.');
    if (!(Number(item.vrcusto) >= 0)) return setErro('Informe o custo antes de precificar.');
    setCalculando(true);
    setErro(undefined);
    try {
      const r = await precificarItemPedido({
        idproduto: Number(item.idproduto), vrcusto: Number(item.vrcusto) || 0,
        markup: Number(item.markup) || 0, vrvenda: Number(item.vrvenda) || 0,
        icme: item.icme != null ? Number(item.icme) : undefined,
        icm_efetivo: item.icm_efetivo != null ? Number(item.icm_efetivo) : undefined,
        fcp_saida: item.fcp_saida != null ? Number(item.fcp_saida) : undefined,
      });
      // PRATICADO: sem venda digitada, a sugerida — e a escada é refeita sobre ela
      const venda = Number(item.vrvenda) > 0 ? Number(item.vrvenda) : r.vrvendasug;
      const r2 = venda !== (Number(item.vrvenda) || 0)
        ? await precificarItemPedido({ idproduto: Number(item.idproduto), vrcusto: Number(item.vrcusto) || 0, markup: Number(item.markup) || 0, vrvenda: venda,
          icme: item.icme != null ? Number(item.icme) : undefined, icm_efetivo: item.icm_efetivo != null ? Number(item.icm_efetivo) : undefined,
          fcp_saida: item.fcp_saida != null ? Number(item.fcp_saida) : undefined })
        : r;
      setItem((i) => ({ ...i, ...(r2 as unknown as Partial<PedidoCompraItemDto>), vrvenda: venda }));
      mensagem.sucesso(`Venda sugerida R$ ${fmtBRL(r.vrvendasug)} · PMZ R$ ${fmtBRL(r2.pmz)} · margem final ${fmtBRL(r2.margeml2)}%.`);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCalculando(false);
    }
  };

  const salvar = () => {
    if (item.idproduto == null) return setErro('Informe o produto do item.');
    if (multiLoja ? !(somaLojas > 0) : !(Number(item.qtde) > 0)) return setErro('A quantidade (embalagens) deve ser maior que zero.');
    if (!(Number(item.fatorembalagem) > 0)) return setErro('O fator de embalagem deve ser maior que zero.');
    if (!(Number(item.vrcusto) >= 0)) return setErro('Custo inválido.');
    if (multiLoja) {
      onConfirmar({ ...item, qtde: somaLojas, lojas: lojas.map((l) => ({ idempresa: l.idempresa, qtde: Number(porLoja[l.idempresa]) || 0 })) });
    } else {
      onConfirmar({ ...item, qtde: Number(item.qtde) || 1 });
    }
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
              onChange={(v) => void escolherProduto(v)}
              placeholder="Selecione o produto…"
            />
            {origem && (
              <small className="text-fg-muted">
                Herdado da loja: {origem.custo}{item.vrcusto_anterior != null ? ` R$ ${fmtBRL(Number(item.vrcusto_anterior))}` : ''} · {origem.fator}.
              </small>
            )}
          </div>
          {multiLoja ? (
            <div className="sm:col-span-2 flex flex-col gap-gp-xs">
              <span className="text-body-sm font-semibold text-fg-default">Quantidade por loja (embalagens) — o item é a soma: {somaLojas.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</span>
              <div className="grid grid-cols-2 gap-form-gap sm:grid-cols-4">
                {lojas.map((l) => (
                  <NumberField
                    key={l.idempresa}
                    label={`Loja ${l.idempresa}${l.fechado ? ' (fechada)' : ''}`}
                    value={porLoja[l.idempresa] as number | undefined}
                    onChange={(v) => setPorLoja((m) => ({ ...m, [l.idempresa]: Number(v) || 0 }))}
                    decimais={3}
                    min={0}
                    disabled={l.fechado}
                  />
                ))}
              </div>
              {lojas.some((l) => l.fechado) && (
                <small className="text-fg-muted">A quantidade de loja fechada não muda — ela reabre o pedido para alterar.</small>
              )}
            </div>
          ) : (
            <NumberField
              label="&Qtde (embalagens)"
              value={item.qtde as number | undefined}
              onChange={(v) => set('qtde', v as number)}
              decimais={3}
              min={0}
            />
          )}
          <NumberField
            label="&Fator/emb."
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

        {/* COMPOSIÇÃO DO CUSTO (herdada do catálogo; o modal de preço do legado edita no item) */}
        <fieldset className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Composição do custo e impostos</legend>
          <div className="grid grid-cols-2 gap-form-gap sm:grid-cols-4">
            <NumberField label="&IPI" value={item.ipi as number | undefined} onChange={(v) => set('ipi', v)} decimais={2} min={0} endAddon="%" />
            <NumberField label="&Frete" value={item.frete as number | undefined} onChange={(v) => set('frete', v)} decimais={2} min={0} endAddon="%" />
            <NumberField label="Se&guro" value={item.seguro as number | undefined} onChange={(v) => set('seguro', v)} decimais={2} min={0} endAddon="%" />
            <CurrencyField label="Desp. &acessória" value={item.despacessorio as number | undefined} onChange={(v) => set('despacessorio', v)} />
            <CurrencyField label="ICMS-&ST" value={item.icmst as number | undefined} onChange={(v) => set('icmst', v)} />
            <NumberField label="ICMS &entrada" value={item.icme as number | undefined} onChange={(v) => set('icme', v)} decimais={2} min={0} endAddon="%" />
            <NumberField label="ICMS e&fetivo" value={item.icm_efetivo as number | undefined} onChange={(v) => set('icm_efetivo', v)} decimais={2} min={0} endAddon="%" />
            <NumberField label="FCP saída" value={item.fcp_saida as number | undefined} onChange={(v) => set('fcp_saida', v)} decimais={2} min={0} endAddon="%" />
          </div>
          {item.vrcustorep != null && (
            <small className="mt-form-gap block text-fg-muted tabular-nums">
              Custo de reposição da loja R$ {fmtBRL(Number(item.vrcustorep))} — já traz a composição; o custo líquido é o custo menos os créditos.
            </small>
          )}
        </fieldset>

        {/* PREÇO DO ITEM (o comprador forma o preço de venda) — o modal uPrecificacaoProdutos, calculado no servidor */}
        <fieldset className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Preço de venda</legend>
          <div className="grid grid-cols-2 gap-form-gap sm:grid-cols-4">
            <NumberField label="&Markup" value={item.markup as number | undefined} onChange={(v) => set('markup', v)} decimais={2} endAddon="%" />
            <CurrencyField label="&Venda (praticada)" value={item.vrvenda as number | undefined} onChange={(v) => set('vrvenda', v)} />
          </div>
          <div className="mt-form-gap flex flex-wrap items-center gap-gp-sm">
            <Button label="&Calcular preço" variant="soft" disabled={calculando} onClick={() => void precificar()} />
          </div>
          {item.vrcustoliquido != null && (
            <div className="mt-form-gap grid grid-cols-2 gap-x-gp-md gap-y-gp-xs text-body-sm tabular-nums sm:grid-cols-4">
              <span>Créditos: R$ {fmtBRL((Number(item.creditoicm) || 0) + (Number((item as Record<string, unknown>).creditopiscofins) || 0))}</span>
              <span>Custo líq.: R$ {fmtBRL(Number(item.vrcustoliquido) || 0)}</span>
              <span>PMZ: R$ {fmtBRL(Number(item.pmz) || 0)}</span>
              <span>Sugerida: R$ {fmtBRL(Number(item.vrvendasug) || 0)}</span>
              <span>Débitos: R$ {fmtBRL((Number(item.debitoicm) || 0) + (Number((item as Record<string, unknown>).debitopiscofins) || 0))}</span>
              <span>Venda líq.: R$ {fmtBRL(Number(item.vendaliq) || 0)}</span>
              <span>Lucro bruto: R$ {fmtBRL(Number(item.lucrobrutov) || 0)} ({fmtBRL(Number(item.lucrobrutop) || 0)}%)</span>
              <span>Desp. oper.: R$ {fmtBRL(Number(item.despopv) || 0)}</span>
              <span>Lucro líq.: R$ {fmtBRL(Number(item.lucroliqv) || 0)} ({fmtBRL(Number(item.lucroliqp) || 0)}%)</span>
              <span>IR + CSLL: R$ {fmtBRL((Number(item.imprend) || 0) + (Number(item.contsocial) || 0))}</span>
              <span className="font-semibold">Margem final: R$ {fmtBRL(Number(item.margeml2v) || 0)} ({fmtBRL(Number(item.margeml2) || 0)}%)</span>
            </div>
          )}
        </fieldset>
        <div className="flex items-center justify-end gap-gp-sm border-t border-border pt-pad-sm">
          <span className="text-body-sm text-fg-muted">Custo/emb. R$ {fmtBRL(vlrembalagem)} · Total do item (qtde × custo/emb.)</span>
          <span className="rounded-radius-base bg-bg-subtle px-pad-sm py-pad-xs text-body-sm font-semibold text-fg-default tabular-nums">
            R$ {fmtBRL(totalcusto)}
          </span>
        </div>
      </div>
    </Modal>
  );
}
