import { z } from 'zod';

/**
 * CAIXA D.R.E. (FRMRELATORIOCAIXA) — DRE de caixa por conta gerencial (`plc`) no período.
 * Datas em ISO explícito, pela mesma razão dos outros relatórios (dd/mm/aaaa passaria e o PG leria outro mês).
 */
export const relCaixaDreSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  empresas: z.array(z.coerce.number().int().positive()).max(50).optional(),
});
export type RelCaixaDreDto = z.infer<typeof relCaixaDreSchema>;

/**
 * RELATÓRIO DE CAIXA — COMPETÊNCIA (FRMRELATORIOCAIXA, `TRelCompetencia`): os filtros da tela do legado. `regime` é o cbbRelatorios
 * (0 emissão · 1 vencimento), `modelo` o rdgRelatorio (0 Totalizado · 1 Recursos · 2 Recursos totalizado · 3 Agrupado geral),
 * `ordenacao` o rdgTipoRel do modelo Recursos (0 código · 1 descrição), `tpconta` o cbbTpConta (0 receita · 1 despesa · 2 neutra).
 */
export const relCaixaCompetenciaSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  regime: z.enum(['EMISSAO', 'VENCIMENTO']),
  modelo: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0),
  ordenacao: z.union([z.literal(0), z.literal(1)]).optional(),
  empresas: z.array(z.coerce.number().int().positive()).max(50).optional(),
  codoperador: z.coerce.number().int().positive().nullish(),
  codfiscal: z.coerce.number().int().positive().nullish(),
  codpdv: z.coerce.number().int().positive().nullish(),
  plc: z.string().trim().max(30).nullish(),
  tpconta: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullish(),
  obs: z.string().trim().max(255).nullish(),
  cmv: z.boolean().optional(),
  taxasCartao: z.boolean().optional(),
  notasFiscais: z.boolean().optional(),
  custoReposicao: z.boolean().optional(),
  dataNota: z.enum(['DTCONTABIL', 'DTEMISSAO']).optional(),
  expandido: z.boolean().optional(),
});
export type RelCaixaCompetenciaDto = z.infer<typeof relCaixaCompetenciaSchema>;

/** RELATÓRIO DE CAIXA — CAIXA BAIXADO (FRMRELATORIOCAIXA, `TRelCaixaBaixado`): `data` é o cbbRelatorios 2 (emissão) / 3 (pagamento). */
export const relCaixaBaixadoSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  data: z.enum(['EMISSAO', 'PAGAMENTO']),
  empresas: z.array(z.coerce.number().int().positive()).max(50).optional(),
  plc: z.string().trim().max(30).nullish(),
  obs: z.string().trim().max(255).nullish(),
  cmv: z.boolean().optional(),
  expandido: z.boolean().optional(),
});
export type RelCaixaBaixadoDto = z.infer<typeof relCaixaBaixadoSchema>;
