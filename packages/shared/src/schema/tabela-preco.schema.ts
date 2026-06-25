import { z } from 'zod';

/**
 * Cadastro de PRECO (Tabela de Reajuste, legado `PRECO`) — completa o PALETTE de campos:
 * texto (DESCRICAO) + PERCENTUAL (VALOR_REAJUSTE) + 2 flags S/N (REAJUSTE, ATIVO).
 * Os nomes dos campos = nomes de COLUNA (o engine mapeia dto[coluna] direto).
 * Nomes do TIPO prefixados `tabelaPreco*` p/ NÃO colidir com preco.schema (cálculo de preço).
 *
 * Paridade legado (UCadTabelaPreco.pas/.dfm):
 *  - DESCRICAO obrigatória (ValidaCadastro bloqueia se vazia), Size=60 no .dfm.
 *  - VALOR_REAJUSTE é PERCENTUAL 0–100 (CedValorReajuste: DisplayFormat '0.00',
 *    MaxValue=100, ShowButton=False) — NÃO é moeda.
 *  - Se REAJUSTE='S', VALOR_REAJUSTE deve ser > 0 (ValidaCadastro).
 */
export const tabelaPrecoSchema = z
  .object({
    descricao: z
      .string()
      .trim()
      .min(1, 'Informe a descrição da tabela de preço.')
      .max(60),
    // PERCENTUAL 0–100 (numeric(13,2)): aceita number; vazio = undefined (NumberField já entrega undefined).
    valor_reajuste: z
      .number()
      .nonnegative('Valor de reajuste inválido')
      .max(100, 'O valor do reajuste não pode passar de 100%.')
      .optional(),
    reajuste: z.enum(['S', 'N'], { message: "Informe 'S' ou 'N'" }).optional(),
    ativo: z.enum(['S', 'N'], { message: "Informe 'S' ou 'N'" }).optional(),
  })
  .superRefine((data, ctx) => {
    // Legado ValidaCadastro: se REAJUSTE='S', exige VALOR_REAJUSTE > 0.
    if (data.reajuste === 'S' && !(data.valor_reajuste && data.valor_reajuste > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe o valor do reajuste.',
        path: ['valor_reajuste'],
      });
    }
  });

export type CriarTabelaPrecoDto = z.infer<typeof tabelaPrecoSchema>;

export const atualizarTabelaPrecoSchema = z
  .object({
    descricao: z.string().trim().min(1, 'Informe a descrição da tabela de preço.').max(60),
    valor_reajuste: z
      .number()
      .nonnegative('Valor de reajuste inválido')
      .max(100, 'O valor do reajuste não pode passar de 100%.')
      .optional(),
    reajuste: z.enum(['S', 'N'], { message: "Informe 'S' ou 'N'" }).optional(),
    ativo: z.enum(['S', 'N'], { message: "Informe 'S' ou 'N'" }).optional(),
  })
  .partial();
export type AtualizarTabelaPrecoDto = z.infer<typeof atualizarTabelaPrecoSchema>;

export interface TabelaPreco extends CriarTabelaPrecoDto {
  id_preco: number;
  indr?: string | null;
}
