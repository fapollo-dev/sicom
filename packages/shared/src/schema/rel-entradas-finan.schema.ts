import { z } from 'zod';
import { boolQuery } from './bool-query';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** ENTRADAS × FINANCEIRO (`FRMRELENTRADAS_FINAN`) — as NF de entrada do período e os títulos a pagar de cada uma. */
export const relEntradasFinanSchema = z.object({
  dataIni: dia,
  dataFim: dia,
  codparceiro: z.coerce.number().int().positive().optional(),
  /** só as notas SEM nenhum título a pagar — o que a tela existe para achar. */
  somenteSemTitulo: boolQuery(false),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type RelEntradasFinanDto = z.infer<typeof relEntradasFinanSchema>;
