import { z } from 'zod';

/**
 * Lote de Cobrança (legado `UCadLoteCobranca`): MESTRE-DETALHE.
 * Header LOTE_COBRANCA + itens ITENS_LOTECOB — exercita o save do AGREGADO
 * (header + N itens numa única transação) e a exclusão em cascata, espelhando
 * o contrato `TfrmCadMasterDet` do form-base (ver form-base-cadmaster.md §5b).
 */
export const itemLoteSchema = z.object({
  codrcb: z.number({ message: 'Conta a receber é obrigatória' }).int('Conta a receber inválida'), // → ARECEBER
});

export const loteCobrancaSchema = z.object({
  codparceiro: z.number({ message: 'Parceiro é obrigatório' }).int('Parceiro inválido'),
  data: z.string().min(1, 'Data é obrigatória'), // ISO
  itens: z.array(itemLoteSchema).min(1, 'Informe ao menos um item'),
});

export type CriarLoteCobrancaDto = z.infer<typeof loteCobrancaSchema>;
export type ItemLoteDto = z.infer<typeof itemLoteSchema>;

export interface LoteCobranca {
  codlotecob: number;
  codparceiro: number;
  data: string;
  itens: { codilotcob: number; codrcb: number }[];
}
