import { z } from 'zod';

/**
 * INTEGRAÇÃO CONTÁBIL (`FRMTRON`) — corte-1: baixa de cartões.
 *
 * A tela do legado tem um período (data inicial/final) e um radio com as origens; a baixa de cartões é a
 * opção 5 (`uTron.pas:2107`) e vai sempre por PERÍODO — o caminho "por lote" existe na classe
 * (`ParametrosIntegracao.Codigo > 0`) mas a tela nunca o usa. Expomos os dois: o período é o fluxo da tela,
 * o lote serve para reprocessar um lote isolado sem varrer o intervalo.
 *
 * Datas como 'YYYY-MM-DD' (lição 17: `z.coerce.date` vira meia-noite UTC e grava um dia a menos).
 */
const dataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD.');

export const integracaoCartaoSchema = z
  .object({
    dataIni: dataISO,
    dataFim: dataISO,
    idlote: z.coerce.number().int().positive().nullish(),
  })
  .refine((v) => v.dataFim >= v.dataIni, { message: 'A data final não pode ser anterior à inicial.', path: ['dataFim'] });
export type IntegracaoCartaoDto = z.infer<typeof integracaoCartaoSchema>;

/**
 * corte-3 — os lançamentos por DOCUMENTO. Mesmo período da tela; `codigo` é o documento isolado (a conta a
 * pagar, o recebível, o lote da transferência ou do caixa, o grupo do convênio), o `ParametrosIntegracao.Codigo`
 * do legado. O que ele significa muda com o tipo — está documentado em cada método do serviço.
 */
export const integracaoDocumentoSchema = z
  .object({
    dataIni: dataISO,
    dataFim: dataISO,
    codigo: z.coerce.number().int().positive().nullish(),
  })
  .refine((v) => v.dataFim >= v.dataIni, { message: 'A data final não pode ser anterior à inicial.', path: ['dataFim'] });
export type IntegracaoDocumentoDto = z.infer<typeof integracaoDocumentoSchema>;
