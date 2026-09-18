import { z } from 'zod';
import { boolQuery } from './bool-query';

/** BALANCETE DE VERIFICAÇÃO (`FRMRELBALANCETE`). */
export const balanceteSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** faixa de contas pelo código expandido (`edtConta`/`edtConta2`); só a inicial = prefixo. */
  contaIni: z.string().trim().max(30).optional(),
  contaFim: z.string().trim().max(30).optional(),
  /** `ComboBoxNivel`: até que nível mostrar (1–5). */
  nivelMax: z.coerce.number().int().min(1).max(5).default(5),
  semMovimento: boolQuery(false),
  analiticas: boolQuery(true),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type BalanceteDto = z.infer<typeof balanceteSchema>;
