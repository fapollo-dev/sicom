import { z } from 'zod';

/**
 * Cadastro de Bairros — tabela REAL `BAIRRO` do schema legado (existe no Oracle, porém
 * VAZIA e SEM tela Delphi de referência). Tela NOVA de manutenção sobre tabela real;
 * exercita o palette: texto (DESCRICAO) + COMBO (REGIAO) + flag (ATIVO). Soft-delete por
 * INDR (como Marcas). REGIAO é um código VARCHAR2(2): o domínio C/N/S/L/O/NL/SL/NO/SO é
 * NOSSA interpretação de zona urbana (não há view/legado que o defina). ATIVO é flag S/N.
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
