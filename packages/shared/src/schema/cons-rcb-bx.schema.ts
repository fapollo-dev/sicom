import { z } from 'zod';

/** CONSULTA DE BAIXAS DO A RECEBER POR LOTE (`FRMCONSRCBBX`) — gêmea da `cons-apg-bx`. */
export const consRcbBxLotesSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  codparceiro: z.coerce.number().int().positive().optional(),
  situacao: z.enum(['todos', 'ativos', 'revertidos']).default('todos'),
  limite: z.coerce.number().int().positive().max(2000).default(300),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type ConsRcbBxLotesDto = z.infer<typeof consRcbBxLotesSchema>;

/** a observação editável da baixa (o painel "Observação" com Editar/Gravar do legado). */
export const consRcbBxObsSchema = z.object({ obs: z.string().max(500) });
export type ConsRcbBxObsDto = z.infer<typeof consRcbBxObsSchema>;
