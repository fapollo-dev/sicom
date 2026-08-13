import { z } from 'zod';

/**
 * GRÁFICO DE FORMAS DE PAGAMENTO — relatório 08 do hub FRMRELVENDAS: participação de cada finalizadora no
 * período. Só período/hora: para esta variante o legado curto-circuita os demais filtros do frame.
 */
export const relFormasPgtoSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  filtrarHora: z.boolean().optional(),
  horaIni: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  horaFim: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
});
export type RelFormasPgtoDto = z.infer<typeof relFormasPgtoSchema>;
