import { z } from 'zod';

/** MOTIVOS DO AJUSTE DE ESTOQUE (`FRMMOTIVO`) — a tabela `MOTIVOS` do legado (≠ `motivos_operacao`, do scrap). */
export const motivoSchema = z.object({
  descricao: z.string().trim().min(1).max(100),
});
export type MotivoDto = z.infer<typeof motivoSchema>;
