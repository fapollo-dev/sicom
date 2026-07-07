import { z } from 'zod';

/** OPERACAO do ajuste (Oracle AJUSTE_ESTOQUE.OPERACAO). Fórmula sobre o saldo:
 *  AUMENTAR → saldo += qtde · DIMINUIR → saldo −= qtde · SUBSTITUIR → saldo = qtde. */
export const AJUSTE_OPERACAO = ['AUMENTAR', 'DIMINUIR', 'SUBSTITUIR'] as const;
export const AJUSTE_OPERACAO_OPCOES = [
  { value: 'AUMENTAR', label: 'Aumentar (entrada)' },
  { value: 'DIMINUIR', label: 'Diminuir (saída)' },
  { value: 'SUBSTITUIR', label: 'Substituir (definir saldo)' },
] as const;
/** DESTINO (rótulo; nosso estoque é single-bucket — o split loja/depósito = ESTOQUE_DEP, adiado). */
export const AJUSTE_DESTINO = ['LOJA', 'ESTOQUE'] as const;
export const AJUSTE_DESTINO_OPCOES = [
  { value: 'LOJA', label: 'Loja' },
  { value: 'ESTOQUE', label: 'Estoque (depósito)' },
] as const;

/** AJUSTE DE ESTOQUE (FRMAJUSTEESTOQUE) — movimento manual do saldo. */
export const ajustarEstoqueSchema = z
  .object({
    idproduto: z.coerce.number({ message: 'Produto inválido.' }).int().positive('Informe o produto.'),
    operacao: z.enum(AJUSTE_OPERACAO, { message: 'Operação inválida (Aumentar/Diminuir/Substituir).' }),
    destino: z.enum(AJUSTE_DESTINO, { message: 'Destino inválido.' }).optional(),
    // qtde ≥ 0: SUBSTITUIR aceita 0 (zerar o saldo); AUMENTAR/DIMINUIR exigem > 0 (mover 0 é no-op) — no superRefine.
    qtde: z.coerce.number({ message: 'Quantidade inválida.' }).min(0, 'Quantidade inválida.'),
    codmotivo: z.coerce.number({ message: 'Motivo inválido.' }).int().positive('Informe o motivo do ajuste.'),
    obs: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().trim().max(1000).optional()),
  })
  .superRefine((v, ctx) => {
    if (v.operacao !== 'SUBSTITUIR' && !(v.qtde > 0))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['qtde'], message: 'A quantidade deve ser maior que zero.' });
  });
export type AjustarEstoqueDto = z.infer<typeof ajustarEstoqueSchema>;

/** registro devolvido (lista/histórico). */
export interface AjusteEstoque {
  codajuste: number;
  idproduto: number;
  produto?: string;
  idempresa: number;
  operacao: string;
  destino?: string | null;
  qtde: number;
  qtdeanterior?: number | null;
  qtdeatual?: number | null;
  codmotivo: number;
  motivo?: string | null;
  codoperador?: number | null;
  origem?: string | null;
  obs?: string | null;
  estornado?: string | null; // 'S' = estornado
  dtcadastro?: string;
}
