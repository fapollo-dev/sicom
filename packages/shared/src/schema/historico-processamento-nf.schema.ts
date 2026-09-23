import { z } from 'zod';
import { boolQuery } from './bool-query';

/**
 * HISTÓRICO DE PROCESSAMENTO DA NF — a auditoria de por que o custo do produto mudou. Migration 291.
 *
 * ⚠️ Cada evento grava DUAS linhas: `PRODUTO` é o estado ANTES e `PROCESSAMENTO` é o DEPOIS. A consulta
 * devolve o par casado, porque ler só um dos dois dá metade da história.
 */
export const histProcNfConsultaSchema = z.object({
  /** a linha do tempo do custo de um produto (o uso principal) */
  codproduto: z.coerce.number().int().positive().optional(),
  /** ou o que uma nota inteira mudou */
  codnf: z.coerce.number().int().positive().optional(),
  data_ini: z.string().trim().date().optional(),
  data_fim: z.string().trim().date().optional(),
  /** só os processamentos que de fato mexeram no custo (94% deles, mas o filtro existe) */
  so_alterou_custo: boolQuery(false),
  limite: z.coerce.number().int().positive().max(2000).default(200),
}).refine((d) => d.codproduto != null || d.codnf != null,
  { message: 'informe o produto ou a nota' });
export type HistProcNfConsultaDto = z.infer<typeof histProcNfConsultaSchema>;
