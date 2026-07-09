import { z } from 'zod';

/**
 * CONDIÇÃO DE PAGAMENTO (CONDICOES_PAGTO) — cadastral GLOBAL (37 linhas no legado). Define os PRAZOS em
 * DIAS de cada parcela em até 8 campos inline (CD1..CD8). O nº de parcelas de um pedido = qtd de CDn
 * não-nulos. É lookup do Pedido de Compra (codconpagto) — a geração das parcelas usa esses dias.
 * Mensagens em PT (ADR-015).
 */

const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());
const dia = () => opcional(z.coerce.number().int().nonnegative('Prazo (dias) inválido.').max(3650, 'Prazo (dias) acima do limite.'));

const condicoesPagtoBase = z.object({
  descricao: opcional(z.string().trim().max(100)),
  cd1: dia(),
  cd2: dia(),
  cd3: dia(),
  cd4: dia(),
  cd5: dia(),
  cd6: dia(),
  cd7: dia(),
  cd8: dia(),
});

/** CREATE — exige ao menos o CD1 (uma condição sem nenhum prazo não gera parcela alguma). */
export const condicoesPagtoSchema = condicoesPagtoBase.superRefine((v, ctx) => {
  if (v.cd1 == null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cd1'], message: 'Informe ao menos o 1º prazo (CD1).' });
});
export type CriarCondicaoPagtoDto = z.infer<typeof condicoesPagtoSchema>;

export const atualizarCondicoesPagtoSchema = condicoesPagtoBase.partial();
export type AtualizarCondicaoPagtoDto = z.infer<typeof atualizarCondicoesPagtoSchema>;

export interface CondicaoPagto {
  codconpagto: number;
  codigo?: number;
  descricao?: string | null;
  cd1?: number | null;
  cd2?: number | null;
  cd3?: number | null;
  cd4?: number | null;
  cd5?: number | null;
  cd6?: number | null;
  cd7?: number | null;
  cd8?: number | null;
}
