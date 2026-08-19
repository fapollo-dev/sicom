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

/**
 * MOTOR da análise (corte-2b): criar a análise a partir dos pedidos + notas escolhidos e processá-la.
 * `total_parcial` decide se a diferença de QUANTIDADE conta ('T' total) ou não ('P' parcial).
 */
export const analiseCriarSchema = z.object({
  codpedcomps: z.array(z.coerce.number().int().positive()).min(1, 'Selecione pelo menos um pedido.').max(200),
  refs_nf: z.array(z.coerce.number().int().positive()).min(1, 'A nota fiscal não foi informada.').max(200),
  total_parcial: z.enum(['T', 'P']).optional(),
});
export type AnaliseCriarDto = z.infer<typeof analiseCriarSchema>;

export const analiseProcessarSchema = z.object({ apn_id: z.coerce.number().int().positive() });
export type AnaliseProcessarDto = z.infer<typeof analiseProcessarSchema>;
