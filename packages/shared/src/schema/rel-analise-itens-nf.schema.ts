import { z } from 'zod';

/**
 * ANÁLISE DE ITENS DA NOTA FISCAL (`FRMRELANALISEITENSNF`, `uRelAnaliseItensNF.pas`).
 *
 * Item a item das notas do período, com custo, base de cálculo, ICMS, ST e o que é isento.
 */
export const relAnaliseItensNfSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /**
   * ⚠️ o legado **não filtra o tipo**: em agosto/2026 somava 6.840 notas de entrada com **943 de saída**.
   * Aqui é escolha, e o padrão é entrada — que é o que faz sentido num relatório de custo e crédito.
   */
  tipo: z.enum(['E', 'S', 'TODAS']).default('E'),
  incluirCanceladas: z.enum(['S', 'N']).default('N'),
  codfor: z.coerce.number().int().positive().optional(),
  coddpto: z.coerce.number().int().positive().optional(),
  codgrupo: z.coerce.number().int().positive().optional(),
  codproduto: z.coerce.number().int().positive().optional(),
  codnf: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().max(20000).default(5000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });

export type RelAnaliseItensNfDto = z.infer<typeof relAnaliseItensNfSchema>;
