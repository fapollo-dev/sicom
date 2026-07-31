import { z } from 'zod';

/**
 * ETIQUETAS DE PREÇO (FRMETIQUETA — Uetiqueta) — corte-1: a fila (etiqueta_cons_prod, produzida pelo coletor) é
 * consumida aqui: lista pendentes da empresa, computa o conteúdo (preço/promo de MULTI_PRECO × fator,
 * server-authoritative), imprime (PDF/HTML) e marca IMPRESSA='S'. Preço impresso = (PROMOCAO='S' ? VRPROMO :
 * VRVENDA) × fator. Modelos .fr3, promo acumulativa/atacarejo, nutricional, coletor = adiados.
 */

/** adicionar um produto à fila — por idproduto OU por código de barras (o service resolve). */
export const etiquetaAdicionarSchema = z
  .object({
    idproduto: z.coerce.number().int().positive().optional(),
    codbarra: z.string().trim().min(1).max(50).optional(),
  })
  .refine((v) => v.idproduto != null || (v.codbarra != null && v.codbarra !== ''), {
    message: 'Informe o produto (id) ou o código de barras.',
  });
export type EtiquetaAdicionarDto = z.infer<typeof etiquetaAdicionarSchema>;

/** 1 item a imprimir: a linha da fila (idetiqueta, quando veio da fila) + qtde + descrição/modelo opcionais. */
export const etiquetaItemImpressaoSchema = z.object({
  idetiqueta: z.coerce.number().int().positive().optional(), // presente = marca IMPRESSA='S' na fila
  idproduto: z.coerce.number().int().positive({ message: 'Informe o produto.' }),
  qtde: z.coerce.number().int().positive({ message: 'Quantidade de etiquetas deve ser > 0.' }).max(9999),
  descricao: z.string().trim().max(500).optional(), // override manual da descrição (fiel: edição no grid)
  modelo: z.string().trim().max(100).optional(),
});
export type EtiquetaItemImpressaoDto = z.infer<typeof etiquetaItemImpressaoSchema>;

export const etiquetaImprimirSchema = z.object({
  itens: z.array(etiquetaItemImpressaoSchema).min(1, 'Selecione ao menos um produto para imprimir.').max(2000),
});
export type EtiquetaImprimirDto = z.infer<typeof etiquetaImprimirSchema>;
