import { z } from 'zod';

/**
 * VENDAS DATA / DEPARTAMENTO — relatório 38 do hub FRMRELVENDAS: dia × departamento, mais o resumo por
 * departamento do período (a banda do impresso) e o ticket médio do período (a query auxiliar).
 */
export const relVendasDepartamentoSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  filtrarHora: z.boolean().optional(),
  horaIni: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  horaFim: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  canceladas: z.enum(['N', 'S', 'T']).optional(),
  promocao: z.enum(['S', 'N', 'T']).optional(),
  produto: z.string().max(60).optional(),
  fornecedor: z.string().max(60).optional(),
  departamentos: z.array(z.coerce.number().int()).max(200).optional(),
  grupos: z.array(z.coerce.number().int()).max(200).optional(),
  subgrupos: z.array(z.coerce.number().int()).max(200).optional(),
  secoes: z.array(z.coerce.number().int()).max(200).optional(),
  aliquota: z.string().max(3).optional(),
});
export type RelVendasDepartamentoDto = z.infer<typeof relVendasDepartamentoSchema>;
