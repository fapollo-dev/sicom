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

/** as parcelas escolhidas na grade do Faturamento (espaço/clique; "marcar todas") */
export const parcelasFaturamentoSchema = z.object({
  codfaturamento: z.array(z.coerce.number().int().positive()).min(1, 'Selecione ao menos uma parcela.').max(500),
});
export type ParcelasFaturamentoDto = z.infer<typeof parcelasFaturamentoSchema>;

/**
 * PROCESSAR (F2): as parcelas e o que o operador ajustou no pré-lançamento — a tela de Contas a Pagar / Receber que o Faturamento
 * abre deixa trocar o vencimento, o valor, o tipo de documento (BOLETO, CARTÃO PRÓPRIO, A VISTA…), o código de barras e, na
 * saída, a forma de pagamento.
 */
export const processarFaturamentoSchema = parcelasFaturamentoSchema.extend({
  ajustes: z.array(z.object({
    codfaturamento: z.coerce.number().int().positive(),
    dtvenc: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD).').optional(),
    valor: z.coerce.number().positive('O valor da parcela tem de ser maior que zero.').optional(),
    tipodoc: z.string().trim().min(1).max(25).optional(),
    codbarrasblt: z.string().trim().max(48).nullable().optional(),
    idpgto: z.coerce.number().int().positive().optional(),
  })).optional(),
  /** a resposta a "O sistema identificou que esta conta pode ter sido lançada anteriormente… Deseja continuar?" */
  confirmarRepetida: z.boolean().optional(),
});
export type ProcessarFaturamentoDto = z.infer<typeof processarFaturamentoSchema>;
