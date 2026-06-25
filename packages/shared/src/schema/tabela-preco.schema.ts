import { z } from 'zod';

/**
 * Cadastro de PRECO (Tabela de Reajuste, legado `PRECO`) — completa o PALETTE de campos:
 * texto (DESCRICAO) + NÚMERO/MOEDA (VALOR_REAJUSTE) + 2 flags S/N (REAJUSTE, ATIVO).
 * Os nomes dos campos = nomes de COLUNA (o engine mapeia dto[coluna] direto).
 * Nomes do TIPO prefixados `tabelaPreco*` p/ NÃO colidir com preco.schema (cálculo de preço).
 */
export const tabelaPrecoSchema = z.object({
  descricao: z.string().trim().max(100).optional(),
  // numeric(13,2): aceita number; vazio = undefined (NumberField já entrega undefined).
  valor_reajuste: z.number().nonnegative('Valor de reajuste inválido').optional(),
  reajuste: z.enum(['S', 'N'], { message: "Informe 'S' ou 'N'" }).optional(),
  ativo: z.enum(['S', 'N'], { message: "Informe 'S' ou 'N'" }).optional(),
});

export type CriarTabelaPrecoDto = z.infer<typeof tabelaPrecoSchema>;

export const atualizarTabelaPrecoSchema = tabelaPrecoSchema.partial();
export type AtualizarTabelaPrecoDto = z.infer<typeof atualizarTabelaPrecoSchema>;

export interface TabelaPreco extends CriarTabelaPrecoDto {
  id_preco: number;
  indr?: string | null;
}
