import { z } from 'zod';

/**
 * CONSULTA DE PRODUTOS (`FRMCONSPROD`, `UconsProd.pas`) e ANÁLISE GERAL DO PRODUTO
 * (`FRMPOSICAOPRODUTO`, `UPosicaoProduto.pas` + `UdmPosicaoProduto.dfm`).
 *
 * A consulta é a porta de entrada: acha o produto por descrição, código de barras ou código, e mostra o que a
 * view de produtos não traz — os **preços**. De dentro dela abre a análise geral, a visão 360 do produto.
 */

/** busca por descrição (LIKE), código de barras (=) ou código interno (=) — as três num campo só. */
export const consultaProdutosSchema = z.object({
  termo: z.string().trim().min(1).max(150),
  limite: z.coerce.number().int().positive().max(500).default(200),
});
export type ConsultaProdutosDto = z.infer<typeof consultaProdutosSchema>;

/** os três itens do RadioGroup do legado: Vendas, Pedidos, Todos. */
export const origemMovimentoEnum = z.enum(['V', 'P', 'T']);
export type OrigemMovimento = z.infer<typeof origemMovimentoEnum>;

export const posicaoProdutoSchema = z.object({
  idproduto: z.coerce.number().int().positive(),
  origem: origemMovimentoEnum.default('V'),
  /** data de referência dos quadros (o legado usa "hoje"); explícita para o resultado ser reproduzível. */
  referencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type PosicaoProdutoDto = z.infer<typeof posicaoProdutoSchema>;

/** o período do Kardex sem o produto (que vem na rota) — é este que o controller valida, com o refine junto. */
export const kardexProdutoQuerySchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  limite: z.coerce.number().int().positive().max(5000).default(1000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type KardexProdutoQueryDto = z.infer<typeof kardexProdutoQuerySchema>;

export const kardexProdutoSchema = z.object({
  idproduto: z.coerce.number().int().positive(),
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  limite: z.coerce.number().int().positive().max(5000).default(1000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type KardexProdutoDto = z.infer<typeof kardexProdutoSchema>;
