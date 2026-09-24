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

/** TRANSFERÊNCIA (`Utransferencia.pas`): débito na conta ORIGEM (da loja) + crédito na conta DESTINO (qualquer loja), no mesmo lote. */
export const transferirContaSchema = z
  .object({
    codorigem: z.coerce.number().int().positive({ message: 'Informe a conta de origem.' }),
    coddestino: z.coerce.number().int().positive({ message: 'Informe a conta de destino.' }),
    valor: z.coerce.number().positive({ message: 'O valor deve ser maior que zero.' }),
    historico: z.string().trim().max(200).optional(), // complemento do histórico padrão das duas pernas
    data: z.string().trim().optional(),
    idpgtoOrigem: z.coerce.number().int().positive().optional(), // modalidade de cada lado (padrão: DINHEIRO)
    idpgtoDestino: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => v.codorigem !== v.coddestino, { message: 'A conta de destino deve ser diferente da origem.', path: ['coddestino'] });
export type TransferirContaDto = z.infer<typeof transferirContaSchema>;

/** LIBERAR movimentos a prazo (o botão com multisseleção e o menu por linha do legado): a data vira a DTLIBERACAO. */
export const liberarMovContaSchema = z.object({
  codconta: z.coerce.number().int().positive(),
  codmovcontas: z.array(z.coerce.number().int().positive()).min(1, { message: 'Selecione ao menos um movimento.' }).max(5000),
  data: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}/, { message: 'Informe a data da liberação.' }),
});
export type LiberarMovContaDto = z.infer<typeof liberarMovContaSchema>;

/** "Mudar data de liberação" do detalhamento. */
export const mudarDataLiberacaoSchema = z.object({
  data: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}/, { message: 'Informe a data.' }),
});
export type MudarDataLiberacaoDto = z.infer<typeof mudarDataLiberacaoSchema>;
