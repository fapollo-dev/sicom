import { z } from 'zod';

/**
 * CARTÕES / RECEBÍVEIS DE CARTÃO (FRMCADCARTAO/FRMCADOPERADORAS) corte-1: OPERADORAS (administradora + taxa
 * por-empresa) + CARTAO (recebível). O líquido e o vencimento são COMPUTADOS na view get_cartao (não no input).
 * empresaScoped no cartao/operadoras_taxa. Idempotente com o read (opcional/dec).
 */

const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

const dec = (inner: z.ZodNumber = z.number()) =>
  z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  }, inner.optional());

// ───────────────────────── OPERADORAS (administradora/adquirente) ─────────────────────────
/** override de taxa/dia-de-compensação por empresa (detalhe de operadoras). */
export const operadoraTaxaSchema = z.object({
  idempresa: z.coerce.number().int().positive({ message: 'Informe a empresa.' }),
  txadm: dec(z.number()),
  diafechamento: dec(z.number().int()),
});
export type OperadoraTaxaDto = z.infer<typeof operadoraTaxaSchema>;

export const operadoraSchema = z.object({
  operadora: z.string().min(1, 'Informe o nome da operadora.').max(50),
  txadm: dec(z.number()),
  txadmparc: dec(z.number()),
  diascomp: dec(z.number().int()),
  tipo: opcional(z.enum(['C', 'D', 'A'])), // Crédito / Débito / Alimentação-voucher
  tipocartao: dec(z.number().int()),
  codbandeira: dec(z.number().int()),
  codadm: dec(z.number().int()),
  codbanco: dec(z.number().int()),
  codoperadorabase: dec(z.number().int()),
  ativo: opcional(z.enum(['S', 'N'])),
  itens: z.array(operadoraTaxaSchema).max(500).optional(), // operadoras_taxa (chave 'itens' do agregado)
});
export type OperadoraDto = z.infer<typeof operadoraSchema>;
export const atualizarOperadoraSchema = operadoraSchema.partial();
export type AtualizarOperadoraDto = z.infer<typeof atualizarOperadoraSchema>;

// ───────────────────────── CARTAO (recebível) ─────────────────────────
/** cadastro manual de um recebível de cartão. valor = BRUTO; líquido/vencimento são computados na view. */
export const cartaoSchema = z.object({
  dtvenda: opcional(z.string()), // ISO; default = agora no engine
  valor: z.coerce.number().positive({ message: 'Informe o valor (bruto) maior que zero.' }),
  codoperadora: z.coerce.number().int().positive({ message: 'Informe a operadora.' }),
  idpgto: dec(z.number().int()),
  nrocupom: opcional(z.string().max(8)),
  nropedido: opcional(z.string().max(14)),
  codpdv: dec(z.number().int()),
  nroparcela: dec(z.number().int()),
  qtde_parcelas: dec(z.number().int()),
  tipocartao: dec(z.number().int()),
  codbandeira: dec(z.number().int()),
  nsu: opcional(z.string().max(10)),
  autorizacao: opcional(z.string().max(30)),
  nrocartao: opcional(z.string().max(50)),
  obs: opcional(z.string().max(2000)),
});
export type CartaoDto = z.infer<typeof cartaoSchema>;
export const atualizarCartaoSchema = cartaoSchema.partial();
export type AtualizarCartaoDto = z.infer<typeof atualizarCartaoSchema>;
