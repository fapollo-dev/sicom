import { z } from 'zod';

/**
 * Cadastro de NCM (legado `NCM`) — completa o PALETTE (data + memo) e prova a
 * CHAVE NATURAL: `codigo` é DIGITADO pelo usuário (não sequence). Datas como ISO
 * 'YYYY-MM-DD' (DateField); descricao/observacao são memos (TextArea, CLOB no legado).
 */
export const ncmSchema = z.object({
  // chave natural: obrigatória no insert (o usuário digita o código NCM)
  codigo: z.number().int('Código NCM inválido').positive('Código NCM inválido'),
  ncmsh: z.string().trim().max(20).optional(),
  descricao: z.string().trim().max(500).optional(),
  ipi: z.string().trim().max(3).optional(),
  vigencia_inicio: z.string().optional(), // ISO date 'YYYY-MM-DD'
  vigencia_fim: z.string().optional(),
  observacao: z.string().trim().optional(),
});

export type CriarNcmDto = z.infer<typeof ncmSchema>;

// no update a PK não muda → parcial e sem exigir codigo
export const atualizarNcmSchema = ncmSchema.partial();
export type AtualizarNcmDto = z.infer<typeof atualizarNcmSchema>;

export interface Ncm extends CriarNcmDto {
  codigo: number;
}
