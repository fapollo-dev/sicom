import { z } from 'zod';

/**
 * FATURAMENTO DA NOTA (`FRMFATURAMENTO2`, `uFaturamento2.pas`).
 *
 * As parcelas de cada nota fiscal: quando vencem, quanto, e se já viraram título no financeiro.
 */

/** por qual data o período recorta (`cbbTpBusca`). */
export const DATAS_FATURAMENTO = [
  { value: 'EMISSAO', label: 'Emissão da nota' },
  { value: 'CONTABIL', label: 'Data contábil' },
  { value: 'PARCELA', label: 'Vencimento da parcela' },
] as const;

export const faturamentoSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  base: z.enum(['EMISSAO', 'CONTABIL', 'PARCELA']).default('PARCELA'),
  /** `E` a pagar (nota de entrada) · `S` a receber (nota de saída) — o par de rádios do legado. */
  tipo: z.enum(['E', 'S']).default('E'),
  /** `N` o que falta faturar · `S` o que já foi · `TODOS`. */
  liberado: z.enum(['N', 'S', 'TODOS']).default('N'),
  nronf: z.string().trim().max(20).optional(),
  codparceiro: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().max(20000).default(3000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });

export type FaturamentoDto = z.infer<typeof faturamentoSchema>;

/** a legenda do legado: vencendo hoje · atrasada · faturada. */
export function situacaoParcela(vencimento: string | null | undefined, liberado: string | null | undefined, hoje: string) {
  if (String(liberado ?? 'N') === 'S') return 'FATURADA';
  if (!vencimento) return 'SEM_VENCIMENTO';
  const v = String(vencimento).slice(0, 10);
  if (v === hoje) return 'VENCE_HOJE';
  return v < hoje ? 'ATRASADA' : 'A_VENCER';
}
