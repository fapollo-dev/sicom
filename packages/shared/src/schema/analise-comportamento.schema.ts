import { z } from 'zod';

/**
 * ANÁLISE DE COMPORTAMENTO DA LOJA (`FRMANALISECOMPORTAMENTO`).
 *
 * Um mês/ano; três blocos (mês anterior, mês atual, ano anterior) × nove linhas × cinco "semanas" fixas;
 * dois comparativos. O recorte por família é opcional e vale nos três blocos.
 */
export const analiseComportamentoSchema = z.object({
  mes: z.coerce.number().int().min(1).max(12),
  ano: z.coerce.number().int().min(2000).max(2100),
  coddpto: z.coerce.number().int().positive().optional(),
  codgrupo: z.coerce.number().int().positive().optional(),
  codsubgrupo: z.coerce.number().int().positive().optional(),
  codsecao: z.coerce.number().int().positive().optional(),
  codfor: z.coerce.number().int().positive().optional(),
});
export type AnaliseComportamentoDto = z.infer<typeof analiseComportamentoSchema>;

/** as contas do plano que a tela soma como "Previsão de Impostos" — a própria tela mantém a lista. */
export const impostosAdicionarSchema = z.object({
  codplcs: z.array(z.coerce.number().int().positive()).min(1).max(200),
});
export type ImpostosAdicionarDto = z.infer<typeof impostosAdicionarSchema>;

/** as nove linhas do original, na ordem em que ele as desenha. */
export const LINHAS_COMPORTAMENTO = [
  'Faturamento', 'CMV', 'Rentabilidade', 'Previsão Impostos', 'Lucro Final',
  'Margem Bruta', 'Margem Final', 'Num. Clientes', 'Ticket Médio',
] as const;
export type LinhaComportamento = (typeof LINHAS_COMPORTAMENTO)[number];
