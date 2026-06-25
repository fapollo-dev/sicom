import { z } from 'zod';

/**
 * Cadastro de CIDADES (legado `CIDADES`) — chave natural (IDCIDADE = IBGE).
 * Alvo do LOOKUP/FK de Bairros. Campos = nomes de coluna (engine mapeia direto).
 */
export const cidadeSchema = z.object({
  idcidade: z.number().int().positive(),
  iduf: z.number().int().optional(),
  cidade: z.string().trim().max(200).optional(),
});

export type CriarCidadeDto = z.infer<typeof cidadeSchema>;

export const atualizarCidadeSchema = cidadeSchema.partial();
export type AtualizarCidadeDto = z.infer<typeof atualizarCidadeSchema>;

export interface Cidade extends CriarCidadeDto {
  idcidade: number;
}
