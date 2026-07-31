import { z } from 'zod';

/**
 * AJUSTE DE PREÇOS - LOTE (FRMAJUSTEPRECOS) — processador da fila LOTEPRECO: as origens propõem o preço; aqui o
 * operador seleciona os lotes pendentes e Processar aplica no MULTI_PRECO (por empresa do lote + propagação por
 * grupo de preço + historico_dinamico + reset de etiqueta via trigger). Sem cálculo de preço nesta tela (fiel).
 */

export const processarLotesSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, 'Selecione ao menos um lote.').max(2000),
});
export type ProcessarLotesDto = z.infer<typeof processarLotesSchema>;

export const excluirLotesSchema = processarLotesSchema;
export type ExcluirLotesDto = z.infer<typeof excluirLotesSchema>;

/** edição permitida no grid do legado: só os campos de PROMO do lote pendente (vrvenda é read-only, fiel). */
export const atualizarLotePromoSchema = z.object({
  promocao: z.enum(['S', 'N']).optional(),
  vrpromo: z.coerce.number().min(0).optional(),
  alteroupromocao: z.enum(['S', 'N']).optional(),
});
export type AtualizarLotePromoDto = z.infer<typeof atualizarLotePromoSchema>;
