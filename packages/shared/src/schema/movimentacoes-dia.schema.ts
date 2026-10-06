import { z } from 'zod';

/**
 * MOVIMENTAÇÕES DO DIA (`FRMMOVIMENTACOESDIA`, `UmovimentacoesDia.pas`).
 *
 * O que aconteceu no período e quem fez: pedidos, contas pagas, contas recebidas e o log de histórico.
 */
export const movimentacoesDiaSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** o filtro por operador do legado, opcional nas quatro abas. */
  codoperador: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().max(10000).default(1000),
  /** as lojas marcadas, "1,2" (vazio = a do login) */
  empresas: z.string().regex(/^[\d,\s]*$/).optional(),
  /** o rgFiltroFaturado: só os pedidos faturados (padrão) ou todos */
  faturados: z.enum(['FATURADOS', 'TODOS']).default('FATURADOS'),
  /** o rgDataPed: a data da venda (padrão) ou a do faturamento */
  dataPedido: z.enum(['VENDA', 'FATURAMENTO']).default('VENDA'),
  /** os tipos de histórico marcados (as TABELAs do HISTORICO), "ARECEBER,CAIXA"; vazio = todos */
  tabelas: z.string().max(2000).optional(),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });

export type MovimentacoesDiaDto = z.infer<typeof movimentacoesDiaSchema>;
