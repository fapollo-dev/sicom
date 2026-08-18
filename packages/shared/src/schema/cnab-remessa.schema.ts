import { z } from 'zod';

/**
 * CNAB de COBRANÇA (FRMCONFBOLETO / uConfBoleto) — corte-1: remessa de ENVIO no layout Itaú 400.
 * A seleção dos títulos é MANUAL no legado (pesquisa GET_ARECEBER + marca a linha), então as rotas recebem
 * a lista de `codrcb` escolhida na tela.
 */
export const cnabTitulosSchema = z.object({
  codparceiro: z.coerce.number().int().positive().optional(),
  /** estado do boleto: 'E' = emitido (elegível à remessa) · 'C' = cancelamento (corte-2). */
  status: z.enum(['E', 'C']).optional(),
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).').optional(),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).').optional(),
});
export type CnabTitulosDto = z.infer<typeof cnabTitulosSchema>;

export const cnabEmitirSchema = z.object({
  codrcbs: z.array(z.coerce.number().int().positive()).min(1, 'Selecione ao menos um título.').max(500),
});
export type CnabEmitirDto = z.infer<typeof cnabEmitirSchema>;

export const cnabGerarSchema = z.object({
  /** a configuração da integração bancária (CONF_INTEG_BANCARIA) — traz layout, agência e o sequencial. */
  codconf: z.coerce.number().int().positive(),
  /** a conta bancária (CONTAS_BANCARIAS) — traz a carteira de cobrança (109 no golden do Itaú). */
  codconta: z.coerce.number().int().positive(),
  codrcbs: z.array(z.coerce.number().int().positive()).min(1, 'Selecione ao menos um título.').max(500),
});
export type CnabGerarDto = z.infer<typeof cnabGerarSchema>;

export const cnabRemessasSchema = z.object({
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type CnabRemessasDto = z.infer<typeof cnabRemessasSchema>;

export const cnabArquivoSchema = z.object({
  cod_remessa_areceber: z.coerce.number().int().positive(),
});
export type CnabArquivoDto = z.infer<typeof cnabArquivoSchema>;
