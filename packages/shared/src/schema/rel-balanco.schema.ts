import { z } from 'zod';
import { boolQuery } from './bool-query';

/** BALANÇO PATRIMONIAL (`FRMRELBALANCO`) — ativo e passivo numa data. */
export const relBalancoSchema = z.object({
  /** a data do balanço; o "movimento do mês" vai do 1º dia do mês dela até ela (regra do legado). */
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** "Analíticas" — quando false, só as sintéticas (as que têm conta filha). */
  analiticas: boolQuery(true),
  /** "Sem movimento" — quando false, esconde conta sem saldo anterior, débito ou crédito. */
  semMovimento: boolQuery(false),
  /** "Degrau" — a indentação por nível vai na resposta; a tela decide se usa. */
  degrau: boolQuery(true),
  nivelMax: z.coerce.number().int().min(1).max(9).default(9),
});
export type RelBalancoDto = z.infer<typeof relBalancoSchema>;
