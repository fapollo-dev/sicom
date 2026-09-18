import { z } from 'zod';

/**
 * ANÁLISE DE COMPORTAMENTO POR PERÍODO (`FRMRELANALISECOMPORTAMENTOPERIODO`).
 *
 * Três períodos com nome próprio, seis métricas cada, e a diferença da referência para os dois comparados.
 */
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const periodo = z.object({
  /** o nome que o operador dá ao período ("Natal 2025"); vazio = o próprio intervalo vira o rótulo. */
  nome: z.string().trim().max(60).optional(),
  ini: data,
  fim: data,
}).refine((p) => p.fim >= p.ini, { message: 'o fim não pode ser antes do início', path: ['fim'] });

export const analiseComportamentoPeriodoSchema = z.object({
  referencia: periodo,
  comparado1: periodo,
  /** o legado sempre pede dois comparados; aqui o segundo é opcional. */
  comparado2: periodo.optional(),
  /** o checkbox "custo de reposição" do original: troca VRCUSTO por VRCUSTOREP no CMV. */
  custoReposicao: z.boolean().default(false),
  idproduto: z.coerce.number().int().positive().optional(),
  codsecao: z.coerce.number().int().positive().optional(),
  coddpto: z.coerce.number().int().positive().optional(),
  codgrupo: z.coerce.number().int().positive().optional(),
  codsubgrupo: z.coerce.number().int().positive().optional(),
});
export type AnaliseComportamentoPeriodoDto = z.infer<typeof analiseComportamentoPeriodoSchema>;

/** as seis métricas que o legado monta para cada período, na ordem em que ele as desenha. */
export const METRICAS_COMPORTAMENTO = [
  'Faturamento', 'CMV', 'Lucro', 'Rentabilidade', 'Quantidade de tickets', 'Valor ticket médio',
] as const;
export type MetricaComportamento = (typeof METRICAS_COMPORTAMENTO)[number];
