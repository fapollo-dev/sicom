import { z } from 'zod';

/**
 * RELATÓRIO DE PREÇOS ALTERADOS (`FRMRELPRECOSALTERADOS`, `uRelPrecosAlterados.pas`).
 *
 * Que preços mudaram no período, de quanto para quanto e por quem.
 */

/** as duas origens do `rgOrigem`: o preço em vigor ou o lote de alteração. */
export const ORIGENS_PRECO_ALTERADO = [
  { value: 'PRECO', label: 'Preço em vigor (multi_preco)' },
  { value: 'LOTE', label: 'Lote de alteração (lotepreco)' },
] as const;

/** o `rgPromo`: todos, só promoção, só preço normal. */
export const PROMO_PRECO_ALTERADO = ['TODOS', 'PROMOCAO', 'NORMAL'] as const;

export const relPrecosAlteradosSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  origem: z.enum(['PRECO', 'LOTE']).default('PRECO'),
  promocao: z.enum(PROMO_PRECO_ALTERADO).default('TODOS'),
  coddpto: z.coerce.number().int().positive().optional(),
  produto: z.string().trim().max(120).optional(),
  /** o "Retirar itens Grupo Preço" do legado: tira o que pertence a um grupo de preço. */
  semGrupoPreco: z.enum(['S', 'N']).default('N'),
  limite: z.coerce.number().int().positive().max(20000).default(5000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });

export type RelPrecosAlteradosDto = z.infer<typeof relPrecosAlteradosSchema>;
