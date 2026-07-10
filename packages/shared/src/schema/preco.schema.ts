import { z } from 'zod';

/** Precificação — regra de cálculo (TMargemPreco). Modo D=markup/custo, M=margem/venda. */
export const modoPrecificacao = z.enum(['D', 'M'], {
  message: "Modo de precificação inválido (informe 'D' ou 'M')",
});

export const calcularVendaSchema = z.object({
  custo: z.number().nonnegative('Custo não pode ser negativo'),
  margem: z.number(),
  modo: modoPrecificacao,
});
export type CalcularVendaDto = z.infer<typeof calcularVendaSchema>;

export const calcularMargemSchema = z.object({
  venda: z.number().nonnegative('Venda não pode ser negativa'),
  custo: z.number().nonnegative('Custo não pode ser negativo'),
  modo: modoPrecificacao,
});
export type CalcularMargemDto = z.infer<typeof calcularMargemSchema>;

/** Precificação fiscal — parametrizável por regime (atual/reforma/transição). */
export const regimeTributario = z.enum(['atual', 'reforma', 'transicao'], {
  message: 'Regime tributário inválido',
});
const tributosAtuais = z.object({
  icmsEfetivo: z.number(),
  fcp: z.number().default(0),
  pis: z.number(),
  cofins: z.number(),
  despOperacional: z.number().default(0),
  irpj: z.number().optional(),
  csll: z.number().optional(),
  simplesNacional: z.boolean().optional(),
  modoMargem: z
    .enum(['final', 'liquido'], { message: "Modo de margem inválido (informe 'final' ou 'liquido')" })
    .optional(),
});
const tributosReforma = z.object({
  ibs: z.number(),
  cbs: z.number(),
  impostoSeletivo: z.number().optional(),
});
export const calcularFiscalSchema = z.object({
  custo: z.number().nonnegative('Custo não pode ser negativo'),
  margem: z.number(),
  tabela: z.object({
    regime: regimeTributario,
    vigenciaInicio: z.string().default(''),
    fonte: z.string().default(''),
    atuais: tributosAtuais.optional(),
    reforma: tributosReforma.optional(),
  }),
});
export type CalcularFiscalDto = z.infer<typeof calcularFiscalSchema>;

/** Precificação de produto: regra legada (aliquota/UF) + regime da Reforma. */
export const precificarProdutoSchema = z.object({
  custo: z.number().nonnegative('Custo não pode ser negativo'),
  margem: z.number(),
  aliquota: z.string().min(1, 'Código fiscal é obrigatório'), // código fiscal do produto (T01, T56, STB...) — regra legada
  uf: z.string().length(2, 'UF inválida (use a sigla de 2 letras)'),
  pis: z.number().default(0),
  cofins: z.number().default(0),
  despOperacional: z.number().default(0),
  // motor completo: FCP + IR/CSLL (PMZ / margem líquida) + componentes do custo líquido (default 0).
  fcp: z.number().default(0),
  irpj: z.number().optional(),
  csll: z.number().optional(),
  st: z.number().optional(),
  ipi: z.number().optional(),
  frete: z.number().optional(),
  seguro: z.number().optional(),
  despac: z.number().optional(),
  creditoPis: z.number().optional(),
  creditoIcms: z.number().optional(),
  modoMargem: z
    .enum(['final', 'liquido'], { message: "Modo de margem inválido (informe 'final' ou 'liquido')" })
    .optional(),
  regime: regimeTributario,
  dataRef: z.string().optional(),
});
export type PrecificarProdutoDto = z.infer<typeof precificarProdutoSchema>;
