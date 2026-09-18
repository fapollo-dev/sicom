import { z } from 'zod';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** LIVRO DIÁRIO (`FRMRELDIARIOCONTABIL`) — cada lançamento em duas linhas (débito e crédito). */
export const relDiarioContabilSchema = z.object({
  dataIni: dia,
  dataFim: dia,
  /** recorte por conta (código expandido, por prefixo). */
  conta: z.string().trim().max(30).optional(),
  codorigem: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().max(50000).default(10000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type RelDiarioContabilDto = z.infer<typeof relDiarioContabilSchema>;
