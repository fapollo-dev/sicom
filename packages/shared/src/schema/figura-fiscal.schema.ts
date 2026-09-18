import { z } from 'zod';

/** CADASTRO DE FIGURAS FISCAIS (`FRMCADFIGURASFISCAIS`) — o catálogo que o indexador tributário aponta. */
export const figuraFiscalSchema = z.object({
  descfigurafiscal: z.string().trim().min(1).max(255),
  codreduzido: z.string().trim().max(20).nullable().optional(),
});
export type FiguraFiscalDto = z.infer<typeof figuraFiscalSchema>;

export const figuraFiscalConsultaSchema = z.object({
  q: z.string().trim().max(60).optional(),
  /** só as que o indexador tributário realmente usa (11 das 16.838 no cliente). */
  somenteEmUso: z.coerce.boolean().default(false),
  limite: z.coerce.number().int().positive().max(2000).default(200),
});
export type FiguraFiscalConsultaDto = z.infer<typeof figuraFiscalConsultaSchema>;
