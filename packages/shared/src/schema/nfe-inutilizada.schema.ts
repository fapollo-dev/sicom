import { z } from 'zod';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** NF-e / NFC-e INUTILIZADAS (`FRMNFE_INUTILIZADA`) — o livro das numerações queimadas. */
export const nfeInutilizadaSchema = z.object({
  data: dia,
  tiponf: z.enum(['NFCE', 'NFE']).default('NFCE'),
  serie: z.string().trim().max(3).nullable().optional(),
  numeracaoIni: z.coerce.number().int().positive(),
  numeracaoFim: z.coerce.number().int().positive(),
  protocolo: z.string().trim().max(30).nullable().optional(),
}).refine((f) => f.numeracaoFim >= f.numeracaoIni, { message: 'o número final não pode ser menor que o inicial', path: ['numeracaoFim'] });
export type NfeInutilizadaDto = z.infer<typeof nfeInutilizadaSchema>;

export const nfeInutilizadaConsultaSchema = z.object({
  dataIni: dia,
  dataFim: dia,
  tiponf: z.enum(['NFCE', 'NFE']).optional(),
  serie: z.string().trim().max(3).optional(),
  numero: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().max(20000).default(2000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type NfeInutilizadaConsultaDto = z.infer<typeof nfeInutilizadaConsultaSchema>;
