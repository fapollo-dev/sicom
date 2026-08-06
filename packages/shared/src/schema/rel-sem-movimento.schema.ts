import { z } from 'zod';

/**
 * PRODUTOS SEM MOVIMENTO NO PERÍODO — relatório 13 do hub FRMRELVENDAS. O complemento da rel 01: mostra o que
 * NÃO girou. Os 5 modos são os do diálogo `OpcoesForm` do legado (uVendas.pas:1418-1424).
 */
export const relSemMovimentoSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  modo: z.enum(['SEM_COMPRA', 'SEM_VENDA', 'SEM_NENHUMA', 'COMPROU_SEM_SAIDA', 'VENDEU_SEM_COMPRA']).optional(),
  empresas: z.array(z.coerce.number().int().positive()).max(50).optional(),
  codfor: z.coerce.number().int().positive().optional(),
  departamento: z.coerce.number().int().optional(),
  grupo: z.coerce.number().int().optional(),
  subgrupo: z.coerce.number().int().optional(),
  secao: z.coerce.number().int().optional(),
  /** FSubData do legado: recorta pelos produtos CADASTRADOS nesta faixa. */
  cadastradoDe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cadastradoAte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type RelSemMovimentoDto = z.infer<typeof relSemMovimentoSchema>;
