import { z } from 'zod';

/**
 * CANCELAMENTOS (rel 28 ×3 / 30) e DESCONTOS DE OPERADOR (rel 32 ×2) do hub FRMRELVENDAS.
 * Só período/hora — o recorte de cancelado/desconto é regra fixa de cada variante.
 */
export const relCanceladosSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  filtrarHora: z.boolean().optional(),
  horaIni: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  horaFim: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
});
export type RelCanceladosDto = z.infer<typeof relCanceladosSchema>;
