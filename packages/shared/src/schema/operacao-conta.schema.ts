import { z } from 'zod';

/**
 * Cadastro de Operações de Conta (legado `uCadOperacoesConta`, tabela OPERACOES_CONTA).
 * Difere do piloto Bancos: tem um CAMPO DE LISTA FIXA (TIPO) — exercita o `Select`.
 *  - DESCRICAO: obrigatória, max 100. **Sem uppercase** (o `.dfm` não tem CharCase, ≠ Bancos).
 *  - TIPO: char(1) obrigatório — 'C' (Crédito) | 'D' (Débito). Combo do legado:
 *    Values ['C','D'] ↔ Items ['1 - CREDITO','2 - DEBITO']; a view decodifica C→CREDITO else DEBITO.
 */
export const TIPO_OPERACAO_CONTA = [
  { value: 'C', label: '1 - CREDITO' },
  { value: 'D', label: '2 - DEBITO' },
] as const;

export const operacaoContaSchema = z.object({
  descricao: z
    .string()
    .trim()
    .min(1, 'Descrição é obrigatória')
    .max(100, 'Descrição deve ter no máximo 100 caracteres'),
  tipo: z.enum(['C', 'D'], { message: "Tipo inválido (informe 'C' ou 'D')" }),
});

export type CriarOperacaoContaDto = z.infer<typeof operacaoContaSchema>;

export const atualizarOperacaoContaSchema = operacaoContaSchema.partial();
export type AtualizarOperacaoContaDto = z.infer<typeof atualizarOperacaoContaSchema>;

export interface OperacaoConta extends CriarOperacaoContaDto {
  codopconta: number;
  usultalteracao?: number | null;
  dtultimalteracao?: string | null;
  dtcadastro?: string | null;
}
