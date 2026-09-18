import { z } from 'zod';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** PRECIFICAÇÃO PELA NF BRUTA (`FRMPRECIFICACAONFBRUTA`) — a consulta dos itens da nota de entrada. */
export const precificacaoNfBrutaConsultaSchema = z.object({
  nronf: z.string().trim().max(12).optional(),
  dataIni: dia.optional(),
  dataFim: dia.optional(),
  codparceiro: z.coerce.number().int().positive().optional(),
  /** só os itens cujo preço sugerido difere do preço atual — os que a tela marcaria. */
  somenteComSugestao: z.coerce.boolean().default(false),
  limite: z.coerce.number().int().positive().max(20000).default(2000),
});
export type PrecificacaoNfBrutaConsultaDto = z.infer<typeof precificacaoNfBrutaConsultaSchema>;

/** o botão Aplicar: enfileira o lote de preço e grava o markup fixo, numa transação só. */
export const precificacaoNfBrutaAplicarSchema = z.object({
  itens: z.array(z.object({
    idproduto: z.coerce.number().int().positive(),
    /** o preço sugerido que vai para a fila (`LOTEPRECO.VRVENDA`). */
    vrvenda: z.coerce.number().positive(),
    /** a margem digitada, que o legado grava em `LOTEPRECO.MARKUP`. */
    markup: z.coerce.number().optional(),
    /** o markup fixo do produto (`MULTI_PRECO.MARKUPFIXO`); ausente = não mexe. */
    markupfixo: z.coerce.number().optional(),
    nronf: z.string().trim().max(12).optional(),
  })).min(1).max(2000),
  obs: z.string().trim().max(200).optional(),
});
export type PrecificacaoNfBrutaAplicarDto = z.infer<typeof precificacaoNfBrutaAplicarSchema>;
