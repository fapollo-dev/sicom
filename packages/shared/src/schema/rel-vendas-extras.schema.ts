import { z } from 'zod';

/**
 * LOTE "EXTRAS" do hub FRMRELVENDAS — rel 21 (ticket por produto), 22 (produtos em promoção por loja),
 * 26 (vendas por departamento/gráfico), 33 (giro por fornecedor) e 39 (dia × hora do pedido).
 */
export const relVendasExtrasSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  filtrarHora: z.boolean().optional(),
  horaIni: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  horaFim: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  canceladas: z.enum(['N', 'S', 'T']).optional(),
  produto: z.string().max(60).optional(),
  fornecedor: z.string().max(60).optional(),
  departamentos: z.array(z.coerce.number().int()).max(200).optional(),
  grupos: z.array(z.coerce.number().int()).max(200).optional(),
  subgrupos: z.array(z.coerce.number().int()).max(200).optional(),
  secoes: z.array(z.coerce.number().int()).max(200).optional(),
});
export type RelVendasExtrasDto = z.infer<typeof relVendasExtrasSchema>;
