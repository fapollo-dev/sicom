import { z } from 'zod';
import { stripNulls } from './strip-nulls';

/**
 * Cadastro de Marcas (legado `MARCAS`). Novidade: **SOFT-DELETE** (INDR).
 * No form-base, excluir não apaga a linha — marca INDR='E' (+ INDR_USUARIO/INDR_DATA),
 * e a pesquisa filtra `COALESCE(INDR,'I')='I'` (esconde os excluídos). Cobre o último
 * branch do `TfrmCadMaster.ExcluirRegistro` (ver form-base-cadmaster.md §3).
 */
const marcaBase = z.object({
  // Fiel ao legado: DESCRICAO é NULLABLE e NÃO é Required (a tela não valida obrigatório).
  // Mantemos só o limite de tamanho da coluna (VARCHAR2(100)) — sem "obrigatório".
  descricao: z.string().trim().max(100, 'Descrição deve ter no máximo 100 caracteres').optional(),
});

export const marcaSchema = z.preprocess(stripNulls, marcaBase); // fold varredura null→ausente
export type CriarMarcaDto = z.infer<typeof marcaSchema>;
export const atualizarMarcaSchema = z.preprocess(stripNulls, marcaBase.partial());
export type AtualizarMarcaDto = z.infer<typeof atualizarMarcaSchema>;

export interface Marca extends CriarMarcaDto {
  idmarca: number;
  indr?: string | null; // 'E' = excluído (soft-delete)
}
