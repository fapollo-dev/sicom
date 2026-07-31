import { z } from 'zod';

/**
 * CONTROLE DE CONTAS CORRENTES (FRMCONTROLECONTASBANCARIAS) — corte-1: lançamentos manuais no razão de tesouraria.
 * Lançamento manual (1 linha via operação C/D), transferência entre contas (2 linhas por lote), estorno. Saldo =
 * Σ com sinal. Split LIBERADO, forma-de-pgto, chaveamento de período, integração contábil = adiados.
 */

/** lançamento MANUAL: escolhe uma operação (define C/D) + valor + histórico (+ data/forma-pgto opcionais). */
export const lancarContaSchema = z.object({
  codconta: z.coerce.number().int().positive({ message: 'Informe a conta.' }),
  codopconta: z.coerce.number().int().positive({ message: 'Informe a operação.' }),
  valor: z.coerce.number().positive({ message: 'O valor deve ser maior que zero.' }),
  historico: z.string().trim().max(255).optional(),
  idpgto: z.coerce.number().int().positive().optional(),
  data: z.string().trim().optional(), // ISO; default = agora no service
});
export type LancarContaDto = z.infer<typeof lancarContaSchema>;

/** TRANSFERÊNCIA: débito na conta ORIGEM + crédito na conta DESTINO (mesmo valor), atômica. */
export const transferirContaSchema = z
  .object({
    codorigem: z.coerce.number().int().positive({ message: 'Informe a conta de origem.' }),
    coddestino: z.coerce.number().int().positive({ message: 'Informe a conta de destino.' }),
    valor: z.coerce.number().positive({ message: 'O valor deve ser maior que zero.' }),
    historico: z.string().trim().max(255).optional(),
    data: z.string().trim().optional(),
  })
  .refine((v) => v.codorigem !== v.coddestino, { message: 'A conta de destino deve ser diferente da origem.', path: ['coddestino'] });
export type TransferirContaDto = z.infer<typeof transferirContaSchema>;
