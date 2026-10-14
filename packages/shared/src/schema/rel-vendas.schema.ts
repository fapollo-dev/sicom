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
  /** CkbExibirProdutosFilhos: agrupa pelo produto FILHO da venda (COALESCE(idproduto_filho, codproduto)). */
  exibirFilhos: z.boolean().optional(),
  custoReposicao: z.boolean().optional(),
  produto: z.string().trim().max(60).optional(),
  fornecedor: z.string().trim().max(60).optional(),
  departamentos: z.array(z.coerce.number().int()).max(2000).optional(),
  grupos: z.array(z.coerce.number().int()).max(2000).optional(),
  subgrupos: z.array(z.coerce.number().int()).max(2000).optional(),
  secoes: z.array(z.coerce.number().int()).max(2000).optional(),
  // o filtro de produtos (MultiProdutos, URelVendas.pas:3419-3447 — com FILTRA_PRODUTOS_RELATORIO_VENDAS = 'S', o Gerar pergunta e abre a
  // Pesquisa em multisseleção): `P.IDPRODUTO IN (…)`, no máximo 1.000 (o teto do legado)
  produtos: z.array(z.coerce.number().int().positive()).max(1000).optional(),
  nrocupom: z.coerce.number().int().nonnegative().optional(),
  nropedido: z.string().trim().max(20).optional(),
  aliquota: z.string().trim().max(6).optional(),
  nropdv: z.coerce.number().int().nonnegative().optional(),
  // a auditoria do URelVendas.dfm (14/10/2026): os filtros do rel 01 que faltavam
  pis: z.enum(['COM', 'SEM', 'T']).optional(), // RGpis: P.IDPISCOFINS > 0 e ALIQ_PIS_SAI > 0 / COALESCE(IDPISCOFINS,0) = 0
  descontoScanntech: z.boolean().optional(), // CkbDescontoScanntech: V.IDPROMOCAO IS NOT NULL (é o que o legado filtra)
  cliente: z.string().trim().max(60).optional(), // edtCliente: UPPER(razão do cliente) LIKE
  vendedor: z.string().trim().max(60).optional(), // edtVendedor: UPPER(VE.RAZAO) LIKE
  operador: z.string().trim().max(60).optional(), // edtOperador: O.LOGIN LIKE
  // gpbLucro: o WHERE externo sobre (TOTAL_VENDA − TOTAL_CUSTO) ou o % de lucro bruto (pela config), com a operação e o valor
  lucro: z.object({
    campo: z.enum(['BRUTO', 'BRUTO_PCT']),
    operacao: z.enum(['=', '<>', '>', '<', '>=', '<=', 'ENTRE']),
    valor: z.coerce.number(),
    valor2: z.coerce.number().optional(),
  }).optional(),
});
export type RelVendasDto = z.infer<typeof relVendasSchema>;
