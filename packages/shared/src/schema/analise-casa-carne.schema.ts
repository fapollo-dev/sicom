import { z } from 'zod';

/**
 * ANÁLISE COMPRA × VENDA — CASA DE CARNE (`FRMANALISECOMPRAVENDACASACARNE`).
 *
 * A casa de carne compra a **peça** e vende os **cortes**. Esta análise casa os dois lados aplicando a
 * `DECOMPOSICAO`: cada corte recebe o percentual que lhe cabe da peça comprada.
 */
export const analiseCasaCarneSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coddpto: z.coerce.number().int().positive().optional(),
  codgrupo: z.coerce.number().int().positive().optional(),
  codsubgrupo: z.coerce.number().int().positive().optional(),
  aliquota: z.string().trim().max(10).optional(),
  produto: z.string().trim().max(120).optional(),
  /** só os produtos que se decompõem (as peças e seus cortes). */
  somenteDecomposicao: z.enum(['S', 'N']).default('N'),
  limite: z.coerce.number().int().positive().max(20000).default(3000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });

export type AnaliseCasaCarneDto = z.infer<typeof analiseCasaCarneSchema>;
