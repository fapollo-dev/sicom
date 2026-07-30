import { z } from 'zod';

/**
 * TROCA DE MERCADORIA COM FORNECEDOR (FRMTROCAMERCADORIAFOR) corte-1: documento mestre-detalhe (troca + itens_troca).
 * O operador registra os produtos avariados/vencidos que saem p/ o fornecedor; o custo (vrcusto/vrcustorep) é
 * SNAPSHOT server-authoritative de MULTI_PRECO. `fechar`/`reabrir` move o estoque (baixa/estorno). empresaScoped.
 */

const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

const dec = (inner: z.ZodNumber = z.number()) =>
  z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  }, inner.optional());

export const trocaItemSchema = z.object({
  idproduto: z.coerce.number().int().positive({ message: 'Informe o produto.' }),
  qtde: z.coerce.number().positive({ message: 'A quantidade deve ser maior que zero.' }),
  estoqueretirada: opcional(z.enum(['LOJA', 'DEPOSITO'])),
  vrcusto: dec(z.number()), // servidor sobrepõe de MULTI_PRECO
  vrcustorep: dec(z.number()),
});
export type TrocaItemDto = z.infer<typeof trocaItemSchema>;

export const trocaSchema = z.object({
  codparceiro: z.coerce.number().int().positive({ message: 'Informe o fornecedor.' }),
  data: opcional(z.string()), // ISO; default = hoje no engine
  descricao: opcional(z.string().max(150)),
  itens: z.array(trocaItemSchema).max(2000).optional(),
});
export type TrocaDto = z.infer<typeof trocaSchema>;
export const atualizarTrocaSchema = trocaSchema.partial();
export type AtualizarTrocaDto = z.infer<typeof atualizarTrocaSchema>;
