import { z } from 'zod';

/**
 * ETIQUETAS DE PREÇO (FRMETIQUETA — Uetiqueta) — corte-1: a fila (etiqueta_cons_prod, produzida pelo coletor) é
 * consumida aqui: lista pendentes da empresa, computa o conteúdo (preço/promo de MULTI_PRECO × fator,
 * server-authoritative), imprime (PDF/HTML) e marca IMPRESSA='S'. Preço impresso = (PROMOCAO='S' ? VRPROMO :
 * VRVENDA) × fator. Modelos .fr3, promo acumulativa/atacarejo, nutricional, coletor = adiados.
 */

/** adicionar um produto à fila — por idproduto OU por código de barras (o service resolve). */
export const etiquetaAdicionarSchema = z
  .object({
    idproduto: z.coerce.number().int().positive().optional(),
    codbarra: z.string().trim().min(1).max(50).optional(),
  })
  .refine((v) => v.idproduto != null || (v.codbarra != null && v.codbarra !== ''), {
    message: 'Informe o produto (id) ou o código de barras.',
  });
export type EtiquetaAdicionarDto = z.infer<typeof etiquetaAdicionarSchema>;

/** de onde a linha veio (o servidor refaz o preço por ela): o produto (código de barras, pesquisa, coletor), um lote do
 *  Ajuste de Preços ou a agenda de promoção. */
export const etiquetaOrigemSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('produto'), caminho: z.enum(['codbarra', 'pesquisa', 'coletor', 'importacao', 'cadastro']), fatorEmbalagem: z.coerce.number().positive().optional() }),
  z.object({ tipo: z.literal('lote'), codlotepreco: z.coerce.number().int().positive() }),
  z.object({ tipo: z.literal('agenda'), codagenda: z.coerce.number().int().positive(), preco: z.enum(['status', 'venda', 'promocional']) }),
  // o preço que a tela de origem mostra (Precificação NF, Relatório de preços alterados) — o legado imprime o que está na tela
  z.object({ tipo: z.literal('preco'), fonte: z.enum(['precificacao', 'precos-alterados']), valor: z.coerce.number().min(0).max(99999999) }),
  z.object({ tipo: z.literal('nf'), codnfprod: z.coerce.number().int().positive() }),
]);

/** as telas que abrem as etiquetas com a lista pronta (cadastro de produto, Precificação NF, preços alterados, NF) */
export const etiquetaDeItensSchema = z.object({
  fonte: z.enum(['cadastro', 'precificacao', 'precos-alterados', 'nf']),
  codnf: z.coerce.number().int().positive().optional(),
  itens: z.array(z.object({ idproduto: z.coerce.number().int().positive(), valor: z.coerce.number().min(0).max(99999999).optional() })).max(5000).optional(),
});
export type EtiquetaDeItensDto = z.infer<typeof etiquetaDeItensSchema>;

/** 1 item a imprimir: o produto + a origem + o que o operador mexe na grade (quantidade, modelo, descrição, observações). */
export const etiquetaItemImpressaoSchema = z.object({
  idetiqueta: z.coerce.number().int().positive().optional(),
  idproduto: z.coerce.number().int().positive({ message: 'Informe o produto.' }),
  qtde: z.coerce.number().int().positive({ message: 'Quantidade de etiquetas deve ser > 0.' }).max(9999),
  descricao: z.string().max(500).optional(), // só quando EDITADA na grade (imprime como está)
  modelo: z.string().trim().max(120).optional(),
  observacao1: z.string().max(255).optional(),
  observacao2: z.string().max(255).optional(),
  origem: etiquetaOrigemSchema.optional(),
});
export type EtiquetaItemImpressaoDto = z.infer<typeof etiquetaItemImpressaoSchema>;

export const etiquetaImprimirSchema = z.object({
  itens: z.array(etiquetaItemImpressaoSchema).min(1, 'Selecione ao menos um produto para imprimir.').max(5000),
  descricaoPor: z.enum(['produto', 'grupo']).optional(),
  observacao1: z.string().max(255).optional(),
  observacao2: z.string().max(255).optional(),
  coletor: z.boolean().optional(),
  listados: z.array(z.coerce.number().int().positive()).max(20000).optional(),
});
export type EtiquetaImprimirDto = z.infer<typeof etiquetaImprimirSchema>;
