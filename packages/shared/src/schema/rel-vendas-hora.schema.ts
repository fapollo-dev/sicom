import { z } from 'zod';

/**
 * VENDAS POR HORA — relatório 07 do hub FRMRELVENDAS: faturamento por hora, nº de caixas abertos por hora
 * (com a média por dia) e, opcionalmente, o detalhe por horário exato.
 */
export const relVendasHoraSchema = z.object({
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
  /** traz o detalhe por horário exato (a subconsulta do legado; some o perfil, não a série temporal) */
  detalhe: z.boolean().optional(),
});
export type RelVendasHoraDto = z.infer<typeof relVendasHoraSchema>;
