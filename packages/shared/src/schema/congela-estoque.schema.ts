import { z } from 'zod';

/** CONGELAR / DESCONGELAR ESTOQUE (`FRMCONGELAESTOQUE`) — a foto do saldo para o balanço. */
export const congelaEstoqueSchema = z.object({
  acao: z.enum(['CONGELAR', 'DESCONGELAR']),
});
export type CongelaEstoqueDto = z.infer<typeof congelaEstoqueSchema>;
