import { z } from 'zod';

/**
 * Cadastro de Contas Bancárias (legado `UCadContasBancarias`, tabela CONTAS_BANCARIAS).
 * Novidade vs telas anteriores: **FK CODBCO → BANCOS** → exercita o padrão de
 * LOOKUP (select cujas opções vêm de OUTRA tabela/recurso).
 * Subconjunto fiel das 28 colunas reais — foco no padrão de lookup/FK.
 */
export const contaBancariaSchema = z.object({
  codbco: z.number({ message: 'Banco é obrigatório' }).int(), // FK → BANCOS (obrigatório)
  titular: z.string().trim().max(50).optional(),
  nroconta: z.string().trim().max(10).optional(),
  ativo: z.enum(['S', 'N']).default('S'),
});

export type CriarContaBancariaDto = z.infer<typeof contaBancariaSchema>;

export const atualizarContaBancariaSchema = contaBancariaSchema.partial();
export type AtualizarContaBancariaDto = z.infer<typeof atualizarContaBancariaSchema>;

export interface ContaBancaria extends CriarContaBancariaDto {
  codconta: number;
  banco?: string; // nome do banco (via join/lookup), para exibição
}
