import { z } from 'zod';

/**
 * DE-PARA de fornecedor (CODREFERENCIA_FOR) — cadastro/manutenção standalone (grade na tela de Produto).
 * Casa o código/EAN do fornecedor ao nosso produto por CODFOR. GLOBAL no legado (sem empresa), mas o acesso
 * é ESCOPADO por fornecedor→empresa (decisão de tenant): só de-para de fornecedores da empresa corrente.
 * codref é normalizado no servidor (normRef, single-source com o import). Mensagens PT (ADR-015).
 */
export const deParaSchema = z.object({
  idproduto: z.coerce.number({ message: 'Produto inválido.' }).int().positive('Informe o produto.'),
  codfor: z.coerce.number({ message: 'Fornecedor inválido.' }).int().positive('Informe o fornecedor.'),
  codref: z.string({ message: 'Informe o código do fornecedor.' }).trim().min(1, 'Informe o código do fornecedor.').max(60),
  tiporef: z.enum(['E', 'P']).optional(), // 'E' EAN / 'P' código do produto — default 'E'
  fator_embalagem: z
    .preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().nonnegative().optional()),
});
export type CriarDeParaDto = z.infer<typeof deParaSchema>;
// UPDATE: idproduto (re-apontar p/ o produto certo), codref, tiporef, fator são editáveis; CODFOR é fixo
// (é parte da chave + o escopo do fornecedor — trocar = excluir e recriar). Omitir codfor evita o no-op
// silencioso do audit-fold (o cliente não manda um campo que o servidor ignoraria).
export const atualizarDeParaSchema = deParaSchema.omit({ codfor: true }).partial();
export type AtualizarDeParaDto = z.infer<typeof atualizarDeParaSchema>;

export interface DePara {
  codreferencia_for?: number;
  idproduto: number;
  codfor: number;
  codref: string;
  tiporef?: string | null;
  tiporefd?: string | null; // EAN/PLU (view)
  fator_embalagem?: number | string | null;
  razao?: string | null; // nome do fornecedor (view)
}
