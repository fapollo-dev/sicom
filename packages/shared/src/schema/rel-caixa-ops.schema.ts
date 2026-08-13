import { z } from 'zod';

/**
 * OPERAÇÕES DE CAIXA do hub FRMRELVENDAS — rel 04 (Sangrias e Suprimentos) e rel 05 (Histórico de
 * liberações do PDV). Só período/hora, como no legado.
 */
export const relCaixaOpsSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  filtrarHora: z.boolean().optional(),
  horaIni: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  horaFim: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
});
export type RelCaixaOpsDto = z.infer<typeof relCaixaOpsSchema>;
