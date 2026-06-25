import { z } from 'zod';

/**
 * Cadastro de Bairros (legado `BAIRRO`) — 1ª tela HERDEIRA COMPLETA via <CadMaster>.
 * Exercita o palette: texto (DESCRICAO) + COMBO (REGIAO) + flag (ATIVO). Soft-delete
 * por INDR (como Marcas). O domínio de REGIAO é inferido do decode do GET_BAIRRO real
 * (C/N/S/L/O/NL/SL/NO/SO). ATIVO é uma flag editável S/N, distinta do soft-delete.
 */
export const REGIAO_BAIRRO = [
  { value: 'C', label: 'Centro' },
  { value: 'N', label: 'Norte' },
  { value: 'S', label: 'Sul' },
  { value: 'L', label: 'Leste' },
  { value: 'O', label: 'Oeste' },
  { value: 'NL', label: 'Nordeste' },
  { value: 'SL', label: 'Sudeste' },
  { value: 'NO', label: 'Noroeste' },
  { value: 'SO', label: 'Sudoeste' },
] as const;

export const ATIVO_SN = [
  { value: 'S', label: 'Sim' },
  { value: 'N', label: 'Não' },
] as const;

export const bairroSchema = z.object({
  // DESCRICAO nullable no legado; mantemos só o limite de tamanho (sem "obrigatório").
  descricao: z.string().trim().max(100).optional(),
  regiao: z
    .enum(['C', 'N', 'S', 'L', 'O', 'NL', 'SL', 'NO', 'SO'], { message: 'Região inválida' })
    .optional(),
  ativo: z.enum(['S', 'N'], { message: "Informe 'S' ou 'N'" }).optional(),
  // LOOKUP/FK → CIDADES (idcidade). Opcional (bairro pode não ter cidade).
  idcidade: z.number().int('Cidade inválida').positive('Cidade inválida').optional(),
});

export type CriarBairroDto = z.infer<typeof bairroSchema>;

export const atualizarBairroSchema = bairroSchema.partial();
export type AtualizarBairroDto = z.infer<typeof atualizarBairroSchema>;

export interface Bairro extends CriarBairroDto {
  idbairro: number;
  indr?: string | null; // 'E' = excluído (soft-delete)
}
