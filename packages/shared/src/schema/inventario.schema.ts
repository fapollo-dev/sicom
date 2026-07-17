import { z } from 'zod';

/**
 * INVENTÁRIO (FRMINVENTARIO — uInventario) — corte-1: NÚCLEO + importar-produtos. Agregado mestre-detalhe
 * (cabeçalho `inventario_livro` + itens `inventario`). FIEL ao legado: é uma PLANILHA (sem máquina de estado),
 * a diferença (sistema − contado) é CALCULADA (não persistida), e a efetivação SOBRESCREVE `estoque.qtde` =
 * contado, item a item, gated por senha de operação ADM (E7). QTDE do item = quantidade CONTADA. Os campos de
 * snapshot (descricao/unidade/custo/venda) são derivados no servidor (produtos + multi_preco). empresaScoped.
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

const flag = (s: z.ZodTypeAny = z.enum(['S', 'N'])) => opcional(s);

/** Item do inventário: o operador informa o produto e a quantidade CONTADA (qtde). O resto é snapshot do servidor. */
export const inventarioItemSchema = z.object({
  idproduto: z.coerce.number().int().positive({ message: 'Informe o produto.' }),
  qtde: z.coerce.number().min(0, 'A quantidade contada não pode ser negativa.'), // CONTADO
  codbarra: opcional(z.string().max(20)),
  descricao: opcional(z.string().max(120)),
  unidade: opcional(z.string().max(6)),
  codsubgrupo: dec(z.number().int()),
  aliquota: opcional(z.string().max(3)),
  vrcusto: dec(z.number()),
  vrvenda: dec(z.number()),
  tipo: opcional(z.string().max(1)),
});
export type InventarioItemDto = z.infer<typeof inventarioItemSchema>;

export const inventarioLivroSchema = z.object({
  descricao: opcional(z.string().max(120)),
  dtinventario: opcional(z.string()), // ISO; default = hoje no service
  dtinicial: opcional(z.string()),
  tipoinventario: dec(z.number().int()),
  modeloinventario: opcional(z.string().max(20)),
  produtos_ativos: flag(),
  apenas_estoque: flag(),
  itens: z.array(inventarioItemSchema).max(50000).optional(),
});
export type InventarioLivroDto = z.infer<typeof inventarioLivroSchema>;
export const atualizarInventarioLivroSchema = inventarioLivroSchema.partial();
export type AtualizarInventarioLivroDto = z.infer<typeof atualizarInventarioLivroSchema>;

/** Importar-produtos: popula a folha de contagem a partir de PRODUTOS (filtros ativo/com-saldo). */
export const importarProdutosInventarioSchema = z.object({
  apenasAtivos: opcional(z.coerce.boolean()),
  apenasComSaldo: opcional(z.coerce.boolean()),
});
export type ImportarProdutosInventarioDto = z.infer<typeof importarProdutosInventarioSchema>;

/** Aplicar ao estoque: gated pela senha de operação ADM (fiel a SenhaAdministrativa('ADM')). */
export const aplicarInventarioSchema = z.object({
  senhaOperacao: opcional(z.string().max(30)),
});
export type AplicarInventarioDto = z.infer<typeof aplicarInventarioSchema>;

/** linha de diferença (calculada): contado vs saldo de sistema. */
export interface InventarioDiferenca {
  idproduto: number;
  descricao: string | null;
  contado: number;
  sistema: number;
  diferenca: number; // sistema − contado (com tratamento de saldo negativo, fiel ao legado)
}
