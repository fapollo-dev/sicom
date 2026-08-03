import { z } from 'zod';

/**
 * RELATÓRIO DE VENDAS (FRMRELVENDAS) — rel 01 "Produtos vendidos no período" (trilha Vendas). Filtro tipado: o
 * legado concatena texto da UI direto no SQL (incl. um "filtro auxiliar" que envelopa a query) — aqui tudo é
 * tipado e ligado por parâmetro, nunca concatenado.
 */
export const relVendasSchema = z.object({
  // ISO obrigatório: '01/08/2026' passaria por min(8) E pela comparação lexicográfica dtini>dtfim, e o PG
  // (DateStyle ISO,MDY) leria 2026-01-08 → o relatório sairia de JAN a MAI sem erro nenhum.
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  // faixa real, não só o formato: '99:99' virava erro 500 do PG (22007) em vez de 422.
  horaIni: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inicial inválida (HH:MM).').optional(),
  horaFim: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora final inválida (HH:MM).').optional(),
  filtrarHora: z.boolean().optional(),
  empresas: z.array(z.coerce.number().int().positive()).max(50).optional(),
  canceladas: z.enum(['N', 'S', 'T']).optional(), // default 'N' (não canceladas), fiel ao legado
  promocao: z.enum(['S', 'N', 'T']).optional(),
  descontos: z.enum(['COM', 'SEM', 'T']).optional(),
  agruparEmpresas: z.boolean().optional(),
  custoReposicao: z.boolean().optional(),
  produto: z.string().trim().max(60).optional(),
  fornecedor: z.string().trim().max(60).optional(),
  departamentos: z.array(z.coerce.number().int()).max(200).optional(),
  grupos: z.array(z.coerce.number().int()).max(200).optional(),
  subgrupos: z.array(z.coerce.number().int()).max(200).optional(),
  secoes: z.array(z.coerce.number().int()).max(200).optional(),
  nrocupom: z.coerce.number().int().nonnegative().optional(),
  nropedido: z.string().trim().max(20).optional(),
  aliquota: z.string().trim().max(6).optional(),
  nropdv: z.coerce.number().int().nonnegative().optional(),
});
export type RelVendasDto = z.infer<typeof relVendasSchema>;
