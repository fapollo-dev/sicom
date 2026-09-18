import { z } from 'zod';

/** CADASTRO DE CEST (`FRMCADCEST`) — a tabela CEST × NCM que `produtos.cest` aponta. */
export const cestSchema = z.object({
  cest: z.string().trim().regex(/^\d{7}$/, 'CEST tem 7 dígitos'),
  ncm: z.string().trim().regex(/^\d{8}$/, 'NCM tem 8 dígitos').nullable().optional(),
  descricao: z.string().trim().min(1).max(1000),
  seguimento: z.string().trim().max(255).nullable().optional(),
  item: z.string().trim().max(8).nullable().optional(),
  anexoxxvii: z.enum(['S', 'N']).nullable().optional(),
});
export type CestDto = z.infer<typeof cestSchema>;

/** busca: por CEST (prefixo), NCM (prefixo) ou trecho da descrição. */
export const cestConsultaSchema = z.object({
  q: z.string().trim().max(60).optional(),
  limite: z.coerce.number().int().positive().max(2000).default(200),
});
export type CestConsultaDto = z.infer<typeof cestConsultaSchema>;
