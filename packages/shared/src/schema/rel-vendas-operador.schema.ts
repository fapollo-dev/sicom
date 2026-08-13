import { z } from 'zod';

/**
 * FAMÍLIA OPERADOR/VENDEDOR do hub FRMRELVENDAS — rel 06 (dia × operador), 19 (resumo por operador),
 * 25 (detalhe por vendedor), 36 (total por vendedor) e 46 (produtos vendidos × operador).
 */
export const relVendasOperadorSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  filtrarHora: z.boolean().optional(),
  horaIni: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  horaFim: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  /** ignorado nas rel 06/25 (CANCELADO='N' hardcoded no SQL do legado) */
  canceladas: z.enum(['N', 'S', 'T']).optional(),
  promocao: z.enum(['S', 'N', 'T']).optional(),
  produto: z.string().max(60).optional(),
  fornecedor: z.string().max(60).optional(),
  departamentos: z.array(z.coerce.number().int()).max(200).optional(),
  grupos: z.array(z.coerce.number().int()).max(200).optional(),
  subgrupos: z.array(z.coerce.number().int()).max(200).optional(),
  secoes: z.array(z.coerce.number().int()).max(200).optional(),
  aliquota: z.string().max(3).optional(),
  /** só a rel 46: agrupa pelo produto FILHO da venda */
  exibirFilhos: z.boolean().optional(),
});
export type RelVendasOperadorDto = z.infer<typeof relVendasOperadorSchema>;
