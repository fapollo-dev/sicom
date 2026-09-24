import { z } from 'zod';

/**
 * LANÇAMENTO DE CAIXA (`FRMMOVCAIXA`, `uMovCaixa`, F06) — o movimento manual da CAIXA gerencial. O valor vem sem sinal:
 * o tipo do centro de custo decide (despesa sai negativa, receita positiva). A despesa gera o título A Pagar já quitado.
 */
const opcional = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

export const lancamentoCaixaSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Informe a data do movimento.' }),
  valor: z.coerce.number().min(0, 'Informe o valor sem sinal — o centro de custo decide se entra ou sai.'),
  codplc: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number({ message: 'É obrigatório informar um plano de contas.' }).int().positive('É obrigatório informar um plano de contas.')),
  codparceiro: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number({ message: 'Informe o parceiro.' }).int().positive('Informe o parceiro.')),
  codconta: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number({ message: 'Informe a conta bancária.' }).int().positive('Informe a conta bancária.')),
  idsituacao_nf: opcional(z.coerce.number().int().positive()),
  obs: opcional(z.string().max(300)),
  neutra: opcional(z.enum(['S', 'N'])),
});
export type LancamentoCaixaDto = z.infer<typeof lancamentoCaixaSchema>;
