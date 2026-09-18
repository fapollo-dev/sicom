import { z } from 'zod';

/**
 * CONSULTA DE BAIXAS DO A PAGAR POR LOTE (`FRMCONSAPGBX`).
 *
 * A busca F3 do legado é por lote em `GET_APAGARBX`; aqui a busca lista os lotes do período (com fornecedor
 * opcional) e a consulta abre um lote: títulos baixados (com a flag de revertido), movimento bancário e o
 * botão de reverter o lote inteiro.
 */
export const consApgBxLotesSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  codparceiro: z.coerce.number().int().positive().optional(),
  /** 'todos' | 'ativos' | 'revertidos' — o legado alterna entre GET_APAGARBX e GET_APAGARBX_REVERTIDAS. */
  situacao: z.enum(['todos', 'ativos', 'revertidos']).default('todos'),
  limite: z.coerce.number().int().positive().max(2000).default(300),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type ConsApgBxLotesDto = z.infer<typeof consApgBxLotesSchema>;
