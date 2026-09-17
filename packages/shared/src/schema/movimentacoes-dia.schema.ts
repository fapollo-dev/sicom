import { z } from 'zod';

/**
 * MOVIMENTAÇÕES DO DIA (`FRMMOVIMENTACOESDIA`, `UmovimentacoesDia.pas`).
 *
 * O que aconteceu no período e quem fez: pedidos, contas pagas, contas recebidas e o log de histórico.
 */
export const movimentacoesDiaSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** o filtro por operador do legado, opcional nas quatro abas. */
  codoperador: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().max(10000).default(1000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });

export type MovimentacoesDiaDto = z.infer<typeof movimentacoesDiaSchema>;
