import { z } from 'zod';
const uf = z.string().trim().length(2).transform((v) => v.toUpperCase());

/** CONFIGURAÇÃO DE LEGISLAÇÃO DA NF-e (`FRMCONFIGLEGISLACAONFE`) — as mensagens legais das observações. */
export const configLegislacaoSchema = z.object({
  descricao: z.string().trim().max(120).nullable().optional(),
  observacoes: z.string().max(8000).nullable().optional(),
  uf: uf.nullable().optional(),
  codcfop: z.coerce.number().int().positive().nullable().optional(),
  codproduto: z.coerce.number().int().positive().nullable().optional(),
  codparceiro: z.coerce.number().int().positive().nullable().optional(),
  tipo: z.string().trim().max(1).nullable().optional(),
});
export type ConfigLegislacaoDto = z.infer<typeof configLegislacaoSchema>;

/** a resolução que o legado faz ao montar a nota: `GetConfigLegislacao(UF, CFOP, produto, parceiro)`. */
export const resolveLegislacaoSchema = z.object({
  uf: uf.optional(),
  codcfop: z.coerce.number().int().positive().optional(),
  codproduto: z.coerce.number().int().positive().optional(),
  codparceiro: z.coerce.number().int().positive().optional(),
});
export type ResolveLegislacaoDto = z.infer<typeof resolveLegislacaoSchema>;
