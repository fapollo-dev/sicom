import { z } from 'zod';

/** GERAR FINANCEIRO EM LOTE (`FRMGERARFINANCEIROLOTE`) — a cobrança mensal dos clientes de valor fixo. */
export const gerarFinanceiroLoteSchema = z.object({
  /** os clientes escolhidos (o legado usa seleção múltipla sobre `CLI='S' AND ATIVADO='S'`). */
  clientes: z.array(z.coerce.number().int().positive()).min(1).max(2000),
  dtvenc: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  codbco: z.coerce.number().int().nonnegative(),
  /** "Vencimento do Cliente": a data de venda vira o dia `VENC_PREV` do mês corrente. */
  usarVencimentoCliente: z.boolean().default(false),
  /** simula sem gravar — devolve o que entraria e o que a guarda anti-duplicidade descartaria. */
  simular: z.boolean().default(false),
});
export type GerarFinanceiroLoteDto = z.infer<typeof gerarFinanceiroLoteSchema>;

/** a lista de candidatos: clientes ativos com valor fixo. */
export const candidatosLoteSchema = z.object({
  q: z.string().trim().max(60).optional(),
  somenteComFixo: z.coerce.boolean().default(true),
  limite: z.coerce.number().int().positive().max(5000).default(500),
});
export type CandidatosLoteDto = z.infer<typeof candidatosLoteSchema>;
