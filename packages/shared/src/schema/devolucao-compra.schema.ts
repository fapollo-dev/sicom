import { z } from 'zod';

/**
 * DEVOLUÇÃO DE COMPRA (FRMDEVOLUCAOCOMPRA — uCadPedidoDevolucaoCompras) — corte-1: NÚCLEO do documento,
 * agregado mestre-detalhe (cabeçalho PEDIDO_DEVOLUCAO_COMPRA + itens). O documento PARTE da NF de ENTRADA
 * original (nunca do pedido de compra): cada item referencia (codnf, codnfprod) da entrada. `qtd_devolvida`
 * ≤ SALDO (qtd da entrada − Σ já devolvido em outros pedidos não-cancelados) — parcial é a norma. Custo/
 * totais rateados da entrada; CFOP de devolução mapeado de CFOP.CFOP_DEVOLUCAO. É TRANSACIONAL PURO (0
 * efeitos) — o FATO nasce na NF de SAÍDA (finalidade=4) que o "Gerar NF de Devolução" emite (cortes 2/3).
 * Fornecedor (codparceiro) obrigatório; ao menos 1 item. Mensagens PT (ADR-015). empresaScoped.
 */

const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

const dec = (inner: z.ZodNumber = z.number()) =>
  z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  }, inner.optional());

export const DEVOLUCAO_STATUS = ['EM_DIGITACAO', 'DIGITADO', 'NOTA_FISCAL_EMITIDA', 'FINALIZADO', 'CANCELADO'] as const;
export type DevolucaoStatus = (typeof DEVOLUCAO_STATUS)[number];

/** Item da devolução: referencia o item da NF de ENTRADA (codnf, codnfprod) + quanto devolver. */
export const devolucaoCompraItemSchema = z.object({
  codnf: z.coerce.number().int().positive(), // a NF de ENTRADA original
  codnfprod: z.coerce.number().int().positive(), // o item da entrada (nf_prod.codnfprod)
  idproduto: z.coerce.number().int().positive(),
  nroitem: opcional(z.coerce.number().int()),
  unidade: opcional(z.string().trim().max(2)),
  fatorembalagem: dec(z.number().positive()),
  cfop: opcional(z.string().trim().max(4)), // CFOP de devolução (server valida/deriva de CFOP_DEVOLUCAO)
  qtd_nota_fiscal: dec(z.number().nonnegative()), // qtd efetiva da entrada (do picker)
  qtd_devolvida: dec(z.number().positive('A quantidade a devolver deve ser maior que zero.')),
  valor_custo: dec(z.number().nonnegative()),
  total_produto_nota: dec(z.number()),
  total_produto_devolvido: dec(z.number()), // server-derivado = valor_custo × qtd_devolvida
  obs: opcional(z.string().trim()),
});
export type DevolucaoCompraItemDto = z.infer<typeof devolucaoCompraItemSchema>;

const devolucaoCompraBase = z.object({
  codparceiro: z.coerce.number().int().positive({ message: 'Informe o fornecedor.' }),
  data: opcional(z.string().trim()),
  produto_troca: opcional(z.enum(['S', 'N'])),
  obs: opcional(z.string().trim()),
  itens: z.array(devolucaoCompraItemSchema).optional(),
});

/** CREATE — exige ao menos 1 item. */
export const devolucaoCompraSchema = devolucaoCompraBase.extend({
  itens: z.array(devolucaoCompraItemSchema).min(1, 'Informe ao menos um item para devolver.'),
});
export type CriarDevolucaoCompraDto = z.infer<typeof devolucaoCompraSchema>;

/** UPDATE — parcial (itens, se vierem, substituem). */
export const atualizarDevolucaoCompraSchema = devolucaoCompraBase.partial();
export type AtualizarDevolucaoCompraDto = z.infer<typeof atualizarDevolucaoCompraSchema>;

/** Item DISPONÍVEL para devolver (retorno do picker: itens de NF de entrada do fornecedor com saldo). */
export interface ItemDisponivelDevolucao {
  codnf: number;
  codnfprod: number;
  idproduto: number;
  nronf: string | null;
  nroitem: number | null;
  descricao?: string | null;
  unidade: string | null;
  fatorembalagem: number | string | null;
  cfop_entrada: string | null;
  cfop_devolucao: string | null; // CFOP de saída mapeado (null = origem sem CFOP_DEVOLUCAO configurado)
  chavenfe: string | null;
  qtd_nota_fiscal: number | string; // qtd efetiva da entrada
  qtd_ja_devolvida: number | string; // Σ devolvido (não cancelado)
  saldo: number | string; // qtd_nota_fiscal − qtd_ja_devolvida (o que ainda dá p/ devolver)
  valor_custo: number | string; // custo unitário da entrada
}

export interface DevolucaoCompra {
  codpeddevcompra?: number;
  codigo?: number;
  idempresa?: number;
  codparceiro?: number;
  fornecedor?: string | null;
  data?: string | null;
  status?: DevolucaoStatus | string | null;
  codnf_emitida?: number | null;
  codoperador?: number | null;
  produto_troca?: string | null;
  obs?: string | null;
  indr?: string | null;
  total?: number | string | null;
  qtde_itens?: number | string | null;
  itens?: DevolucaoCompraItemDto[];
}
