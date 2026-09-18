import { z } from 'zod';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** CAIXA DME (`FRMRELATORIOCAIXADME`) — quem movimentou mais de R$ 30 mil em espécie no período. */
export const caixaDmeSchema = z.object({
  dataIni: dia,
  dataFim: dia,
  tipo: z.enum(['sintetico', 'analitico']).default('sintetico'),
  limite: z.coerce.number().int().positive().max(20000).default(5000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type CaixaDmeDto = z.infer<typeof caixaDmeSchema>;
