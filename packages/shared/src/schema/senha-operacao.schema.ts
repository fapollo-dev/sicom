import { z } from 'zod';

/**
 * SENHA DE OPERAÇÃO por empresa (E7) — EMPRESAS.SENHAADMIN/DESC/CANCEL/GAVETA. O admin define; ações sensíveis
 * (desconto/cancelamento/estorno/gaveta) verificam. Armazenada como HASH (scrypt), não a cifra César do legado.
 */
export const TIPO_SENHA_OPERACAO = ['admin', 'desc', 'cancel', 'gaveta'] as const;
export type TipoSenhaOperacao = (typeof TIPO_SENHA_OPERACAO)[number];

export const senhaOperacaoSetSchema = z.object({
  tipo: z.enum(TIPO_SENHA_OPERACAO),
  senha: z.string().min(1, 'Informe a senha de operação.').max(30),
});
export type SenhaOperacaoSetDto = z.infer<typeof senhaOperacaoSetSchema>;

export const senhaOperacaoVerificarSchema = z.object({
  tipo: z.enum(TIPO_SENHA_OPERACAO),
  senha: z.string().min(1).max(30),
});
export type SenhaOperacaoVerificarDto = z.infer<typeof senhaOperacaoVerificarSchema>;
export interface SenhaOperacaoResultado { ok: boolean }
