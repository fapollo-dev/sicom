import { z } from 'zod';

/**
 * CAIXA D.R.E. (FRMRELATORIOCAIXA) — DRE de caixa por conta gerencial (`plc`) no período.
 * Datas em ISO explícito, pela mesma razão dos outros relatórios (dd/mm/aaaa passaria e o PG leria outro mês).
 */
export const relCaixaDreSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  empresas: z.array(z.coerce.number().int().positive()).max(50).optional(),
});
export type RelCaixaDreDto = z.infer<typeof relCaixaDreSchema>;
