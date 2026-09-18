import { z } from 'zod';

/** RELATÓRIO DE PERDAS (`FRMRELPERDAS`) — sobre os scraps do período; analítico ou sintético. */
export const relPerdasSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipo: z.enum(['analitico', 'sintetico']).default('analitico'),
  codscrap: z.coerce.number().int().positive().optional(),
  codparceiro: z.coerce.number().int().positive().optional(),
  codplc: z.coerce.number().int().positive().optional(),
  idproduto: z.coerce.number().int().positive().optional(),
  codsetor: z.coerce.number().int().positive().optional(),
  codmotivoop: z.coerce.number().int().positive().optional(),
  coddpto: z.coerce.number().int().positive().optional(),
  codgrupo: z.coerce.number().int().positive().optional(),
  codsubgrupo: z.coerce.number().int().positive().optional(),
  codfor: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().max(20000).default(5000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type RelPerdasDto = z.infer<typeof relPerdasSchema>;
