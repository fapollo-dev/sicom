import { z } from 'zod';

/** EXPORTAÇÃO DE NF-e (`FRMEXPORTANFE`) — as notas eletrônicas do período e o XML de cada uma. */
export const exportaNfeSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  modelo: z.enum(['55', '65', 'todos']).default('55'),
  status: z.enum(['todas', 'autorizadas', 'canceladas']).default('todas'),
  limite: z.coerce.number().int().positive().max(5000).default(1000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type ExportaNfeDto = z.infer<typeof exportaNfeSchema>;
