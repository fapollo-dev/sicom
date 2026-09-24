import { z } from 'zod';

/**
 * BAIXA DE CONTAS A PAGAR (`FRMBAIXAAPAGAR`, `UBaixaApagar.pas`) — o lote do legado: N documentos e 1..N recursos, cada
 * recurso numa conta corrente. Especificação: `uBaixaApagar-spec.md`.
 */
const opcionalNum = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional());
const data = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}/, { message: 'Data inválida.' });

/** a pesquisa de títulos (`GET_APAGAR` com as empresas escolhidas) */
export const baixaApagarTitulosSchema = z.object({
  empresas: z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.coerce.number().int().positive()).optional()),
  codparceiro: opcionalNum,
  vencDe: z.preprocess((v) => (v === '' ? undefined : v), data.optional()),
  vencAte: z.preprocess((v) => (v === '' ? undefined : v), data.optional()),
  busca: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(60).optional()),
});
export type BaixaApagarTitulosDto = z.infer<typeof baixaApagarTitulosSchema>;

export const baixaApagarGravarSchema = z.object({
  idlote: z.coerce.number().int().positive(),
  dtpgto: data,
  documentos: z.array(z.object({
    codapg: z.coerce.number().int().positive(),
    calculaJuro: z.boolean().optional(),
    /** acréscimo (+) / desconto (−); sem ele, o `-DESCONTO` do título */
    acreDesc: z.coerce.number().optional(),
  })).min(1, { message: 'Nenhum documento foi informado para realizar a baixa.' }),
  recursos: z.array(z.object({
    /** o índice do combo do legado: 0 DINHEIRO · 2 DOC · 3 TRANSFERÊNCIA BANCÁRIA · 4 DÉBITO EM CONTA */
    tipo: z.coerce.number().int(),
    codconta: z.coerce.number().int().positive({ message: 'Informe a conta corrente.' }),
    valor: z.coerce.number().positive({ message: 'Valor deve ser maior que zero!' }),
    historico: z.string().max(250).nullish(),
  })).min(1, { message: 'Nenhum recurso foi informado.' }),
  ccJuros: opcionalNum,
  ccAcrescimo: opcionalNum,
  ccDesconto: opcionalNum,
  /** "Deseja gerar uma baixa parcial?" — com SIM, a data de vencimento do título-saldo */
  parcial: z.object({ dtvenc: data }).optional(),
  /** a manutenção de lote: o lote antigo, revertido na mesma transação */
  loteManutencao: opcionalNum,
});
export type BaixaApagarGravarDto = z.infer<typeof baixaApagarGravarSchema>;
