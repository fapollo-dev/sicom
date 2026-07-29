import { z } from 'zod';
import { stripNulls } from './strip-nulls';

/**
 * Cadastro de CIDADES (legado `CIDADES`) — chave natural (IDCIDADE = IBGE).
 * Alvo do LOOKUP/FK de Bairros. Campos = nomes de coluna (engine mapeia direto).
 */
const cidadeBase = z.object({
  idcidade: z.number().int('Código IBGE inválido').positive('Código IBGE inválido'),
  iduf: z.number().int('UF inválida').optional(),
  cidade: z.string().trim().max(200).optional(),
});

export const cidadeSchema = z.preprocess(stripNulls, cidadeBase); // fold varredura null→ausente
export type CriarCidadeDto = z.infer<typeof cidadeSchema>;

export const atualizarCidadeSchema = z.preprocess(stripNulls, cidadeBase.partial());
export type AtualizarCidadeDto = z.infer<typeof atualizarCidadeSchema>;

export interface Cidade extends CriarCidadeDto {
  idcidade: number;
}
