import { z } from 'zod';

/**
 * PEDIDO DE COMPRA (FRMPEDIDOCOMPRA) — a MAIOR tela do legado. Corte-1: NÚCLEO cadastro,
 * agregado mestre-detalhe (cabeçalho PEDIDOCOMPRA + itens PEDIDOCOMPRA_I). É o documento de
 * INTENÇÃO de compra (previsão); o FATO (fiscal/estoque/financeiro) nasce na NF de entrada.
 *
 * Achados do recon Oracle refletidos aqui:
 *  - QUANTIDADE do item = FATOREMBALAGEM (o legado não tem coluna "qtd").
 *  - VLREMBALAGEM = FATOREMBALAGEM × VRCUSTO (derivado server-side; total do pedido = Σ VLREMBALAGEM).
 *  - Fornecedor (CODPARCEIRO) obrigatório; ao menos 1 item.
 *  - Impostos/markup/preço-venda do item = simulação/analítica → ADIADO (imposto definitivo é da NF).
 * Mensagens em PT (ADR-015). O pedido é empresaScoped (IDEMPRESA carimbado pelo engine).
 */

/* ── helpers (idem nf.schema) ── */
const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

/** decimal tolerante: aceita número OU string numérica ('' / null → ausente). numeric do PG volta string. */
const dec = (inner: z.ZodNumber = z.number()) =>
  z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  }, inner.optional());

/* ── combos ── */
export const PC_TIPO_FRETE = ['CIF', 'FOB'] as const;
export const PC_TIPO_FRETE_OPCOES = [
  { value: 'CIF', label: 'CIF (por conta do fornecedor)' },
  { value: 'FOB', label: 'FOB (por conta do comprador)' },
] as const;

/* ── item ── */
/** Item do pedido: produto + quantidade (fatorembalagem) + custo negociado. VLREMBALAGEM é derivado. */
export const pedidoCompraItemSchema = z.object({
  idproduto: z.coerce.number({ message: 'Produto inválido.' }).int().positive('Informe o produto do item.'),
  // FATOREMBALAGEM = quantidade pedida (legado). > 0 (pedir 0 é no-op). Teto coerente com a coluna
  // (numeric(13,2)) + garante que fator×custo caiba em VLREMBALAGEM numeric(18,4) sem overflow.
  fatorembalagem: z.coerce
    .number({ message: 'Quantidade inválida.' })
    .positive('A quantidade deve ser maior que zero.')
    .max(9_999_999, 'Quantidade acima do limite permitido.'),
  // custo unitário negociado com o fornecedor (âncora do item). Teto coerente com numeric(12,4).
  vrcusto: z.coerce
    .number({ message: 'Custo inválido.' })
    .nonnegative('Custo inválido.')
    .max(9_999_999, 'Custo acima do limite permitido.'),
  // custo estendido (= fatorembalagem × vrcusto) — server-authoritative; aceito no payload p/ round-trip.
  vlrembalagem: dec(z.number().nonnegative()),
  desconto: dec(z.number().nonnegative('Desconto inválido.')),
  descontop: dec(z.number().nonnegative('Desconto (%) inválido.').max(100, 'Desconto (%) inválido.')),
  obs: opcional(z.string().trim().max(1000)),
});
export type PedidoCompraItemDto = z.infer<typeof pedidoCompraItemSchema>;

/* ── cabeçalho ── */
const pedidoCompraBase = z.object({
  // CODOPERADOR (comprador) e FECHADO (workflow) NÃO entram no payload — são server-controlled.
  codparceiro: z.coerce
    .number({ message: 'Favor informar o fornecedor.' })
    .int('Favor informar o fornecedor.')
    .positive('Favor informar o fornecedor.'),
  data: z.string({ message: 'Informe a data do pedido.' }).trim().min(1, 'Informe a data do pedido.'),
  dt_vencimento: opcional(z.string().trim()),
  codconpagto: opcional(z.coerce.number().int()),
  pc_tipo_frete: opcional(z.enum(PC_TIPO_FRETE)),
  pc_valor_frete: dec(z.number().nonnegative('Valor de frete inválido.')),
  pc_nronf_cruzamento: opcional(z.string().trim().max(500)),
  obs: opcional(z.string().trim().max(2000)),
  itens: z.array(pedidoCompraItemSchema).optional().default([]),
});

/** CREATE — exige ao menos 1 item (btnGravar do legado). */
export const pedidoCompraSchema = pedidoCompraBase.extend({
  itens: z.array(pedidoCompraItemSchema).min(1, 'Informe ao menos um item no pedido.'),
});
export type CriarPedidoCompraDto = z.infer<typeof pedidoCompraSchema>;

/** UPDATE — parcial (o header pode vir só com os campos alterados; itens, se vierem, substituem). */
export const atualizarPedidoCompraSchema = pedidoCompraBase.partial();
export type AtualizarPedidoCompraDto = z.infer<typeof atualizarPedidoCompraSchema>;

/* ── registros devolvidos (lista / agregado) ── */
export interface PedidoCompra {
  codpedcomp: number;
  codigo?: number;
  idempresa?: number;
  data?: string;
  codparceiro: number;
  fornecedor?: string | null;
  codoperador?: number | null;
  dt_vencimento?: string | null;
  codconpagto?: number | null;
  pc_tipo_frete?: string | null;
  pc_valor_frete?: number | string | null;
  pc_nronf_cruzamento?: string | null;
  fechado?: string | null; // 'S' = fechado
  dtfaturamento?: string | null;
  dtencerramento?: string | null;
  obs?: string | null;
  indr?: string | null;
  total?: number | string | null; // Σ vlrembalagem (view)
  qtde_itens?: number | string | null;
  itens?: PedidoCompraItem[];
}

export interface PedidoCompraItem {
  codpedcompi?: number;
  codpedcomp?: number;
  idproduto: number;
  fatorembalagem: number | string;
  vrcusto: number | string;
  vlrembalagem?: number | string | null;
  desconto?: number | string | null;
  descontop?: number | string | null;
  obs?: string | null;
}
