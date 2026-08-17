import { z } from 'zod';

/** MANIFESTO DO DFe (corte 1 local) — a fila das NF-e recebidas + ignorar com motivo. */
export const manifestoListarSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fornecedor: z.string().max(60).optional(),
  chave: z.string().max(50).optional(),
  canceladas: z.enum(['TODOS', 'CANCELADAS', 'NAO_CANCELADAS']).optional(),
  pendentes: z.boolean().optional(),
});
export type ManifestoListarDto = z.infer<typeof manifestoListarSchema>;

export const manifestoIgnorarSchema = z.object({
  codnfe_naocad: z.coerce.number().int().positive(),
  /** obrigatório quando ignora (a tela do legado exige); dispensado ao reverter */
  motivo: z.string().max(255).optional(),
  reverter: z.boolean().optional(),
});
export type ManifestoIgnorarDto = z.infer<typeof manifestoIgnorarSchema>;

export const manifestarSchema = z.object({
  chave: z.string().min(44).max(50),
  evento: z.enum(['CIENCIA', 'CONFIRMACAO', 'DESCONHECIMENTO', 'OPERACAO_NAO_REALIZADA']),
  /** obrigatória só na operação não realizada (o serviço valida) */
  justificativa: z.string().max(255).optional(),
});
export type ManifestarDto = z.infer<typeof manifestarSchema>;
