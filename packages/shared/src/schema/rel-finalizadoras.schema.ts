import { z } from 'zod';

/**
 * VENDAS E FINALIZADORAS (FRMRELFINALIZADORAS). Uma linha por dia; colunas = 4 medidas de venda + uma por
 * modalidade de pagamento cadastrada em `formas_pgto`. Datas em ISO (o legado aceita o formato da estação; aqui
 * é explícito, pela mesma razão da rel-vendas: dd/mm/aaaa passaria e o PG leria outro mês).
 */
export const relFinalizadorasSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  empresas: z.array(z.coerce.number().int().positive()).max(50).optional(),
});
export type RelFinalizadorasDto = z.infer<typeof relFinalizadorasSchema>;
