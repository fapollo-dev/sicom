import { z } from 'zod';

/** PENDÊNCIAS DO OPERADOR — a fila de trabalho (APN/RPN/CFN, Aberta/Finalizada). */
export const pendenciaListarSchema = z.object({
  codoperador: z.coerce.number().int().positive().optional(),
  status: z.enum(['A', 'F', 'E']).optional(),
  tipo: z.enum(['APN', 'RPN', 'CFN']).optional(),
});
export type PendenciaListarDto = z.infer<typeof pendenciaListarSchema>;

export const pendenciaCriarSchema = z.object({
  codoperador: z.coerce.number().int().positive(),
  tipo: z.enum(['APN', 'RPN', 'CFN']),
  complemento: z.string().max(250).optional(),
  observacao: z.string().max(1000).optional(),
});
export type PendenciaCriarDto = z.infer<typeof pendenciaCriarSchema>;

export const pendenciaStatusSchema = z.object({
  po_id: z.coerce.number().int().positive(),
  finalizar: z.boolean(),
  observacao: z.string().max(1000).optional(),
});
export type PendenciaStatusDto = z.infer<typeof pendenciaStatusSchema>;

/** corte-2a: abrir a análise vinculada (PO_COMPLEMENTO da APN/RPN = APN_ID da análise persistida). */
export const pendenciaAnaliseSchema = z.object({
  apn_id: z.coerce.number().int().positive(),
});
export type PendenciaAnaliseDto = z.infer<typeof pendenciaAnaliseSchema>;
