import { z } from 'zod';

/**
 * SIMULADOR DE VENDAS (`FRMSIMULADORVENDA`, `uSimuladorVenda.pas`).
 *
 * Pega o que foi vendido num período, produto a produto, e deixa o operador mexer no preço para ver o que
 * teria acontecido com o lucro.
 */
export const simuladorVendaSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  produto: z.string().trim().max(120).optional(),
  limite: z.coerce.number().int().positive().max(20000).default(3000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });

export type SimuladorVendaDto = z.infer<typeof simuladorVendaSchema>;

/**
 * ⚠️ o "Lucro %" do legado é **markup sobre o custo**, não margem sobre a venda:
 * `((venda / custo) - 1) × 100` (`CalculaLucro`, `:156`). Numa venda de 150 sobre custo 100 ele mostra
 * **50%**, não os 33,3% que a margem daria. Mantido como está — trocar mudaria todo número que o operador
 * conhece.
 */
export const lucroPercentual = (venda: number, custo: number) =>
  custo > 0 ? Math.round(((venda / custo - 1) * 100 + Number.EPSILON) * 100) / 100 : 0;
