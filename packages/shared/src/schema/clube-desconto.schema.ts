import { z } from 'zod';
import { boolQuery } from './bool-query';

/**
 * CLUBE DE DESCONTO — o cadastro das regras. Migration 285. Dossiê `uClubeDesconto.md`.
 *
 * ⚠️ O `valor` só se interpreta junto com o `tipo`, e cada operação exige campos diferentes. As duas
 * coisas são validadas aqui, não no banco, porque o erro tem de chegar ao operador com o nome do campo.
 */

/** as nove operações medidas no cliente, com o que cada uma significa. */
export const OPERACOES_CLUBE = [
  'PRECO',              // preço especial do clube — `valor` é o PREÇO em R$ (2.970 regras)
  'VARIAVEL',           // desconto — `valor` é percentual ou R$, conforme `tipo` (53)
  'GRATIS',             // leve N e pague nada (41)
  'GRATIS_FILHO',       // idem, no produto filho (14)
  'LEVE_PAGUE',         // leve N pague M (10)
  'ADICIONAL',          // unidade adicional com condição (8)
  'ADICIONAL_FILHO',    // idem, no filho (8)
  'DESCONTO_POR_PDV',   // desconto do CUPOM inteiro num PDV — sem código de barras (6)
  'CODIGO_PROMOCIONAL', // cupom por código — sem código de barras (1)
] as const;
export type OperacaoClube = (typeof OPERACOES_CLUBE)[number];

/** operações que agem no CUPOM, não num produto: exigir barras delas impediria o cadastro. */
export const OPERACOES_SEM_BARRAS: readonly string[] = ['DESCONTO_POR_PDV', 'CODIGO_PROMOCIONAL'];
/** operações que exigem a quantidade paga (leve N pague M e as adicionais). */
export const OPERACOES_COM_QTDE_PAGA: readonly string[] =
  ['LEVE_PAGUE', 'GRATIS_FILHO', 'ADICIONAL', 'ADICIONAL_FILHO'];

const dec = (max = 9999999) => z.coerce.number().min(0).max(max);

export const clubeDescontoSchema = z.object({
  /** id da promoção NO SISTEMA DO CLUBE — não é a nossa `promocao` (98,5% das regras são órfãs dela) */
  idpromocao: z.coerce.number().int().nullable().optional(),
  loja: z.coerce.number().int().positive().default(1),
  operacao: z.enum(OPERACOES_CLUBE),
  ativo: z.enum(['S', 'N']).default('S'),
  encerrada: z.enum(['F', 'T']).default('F'),
  origem: z.string().trim().max(2).default('S'),
  barras: z.string().trim().max(20).nullable().optional(),
  grupo: z.coerce.number().int().nullable().optional(),
  /** ⚠️ preço em R$ quando `tipo` é nulo; percentual quando '%'; valor em R$ quando '$' */
  valor: dec().nullable().optional(),
  tipo: z.enum(['%', '$']).nullable().optional(),
  quantidade: dec().nullable().optional(),
  quantidade_paga: dec().nullable().optional(),
  minimo: dec().nullable().optional(),
  maximo: dec().nullable().optional(),
  valor_minimo_compra: dec().nullable().optional(),
  data_inicio: z.string().trim().min(10),
  data_fim: z.string().trim().min(10),
  pdv: z.coerce.number().int().nullable().optional(),
  codigo_promocional: z.string().trim().max(60).nullable().optional(),
  id_formas_pgto: z.string().trim().max(60).nullable().optional(),
  codperfil_parceiro: z.string().trim().max(60).nullable().optional(),
  codparceiro: z.string().trim().max(60).nullable().optional(),
  descricao: z.string().trim().max(200).nullable().optional(),
})
  .refine((d) => new Date(d.data_fim) >= new Date(d.data_inicio),
    { message: 'a data de fim não pode ser anterior à de início', path: ['data_fim'] })
  // ⚠️ barras: obrigatório nas regras de PRODUTO, proibido nas de CUPOM
  .refine((d) => OPERACOES_SEM_BARRAS.includes(d.operacao) || !!d.barras,
    { message: 'esta operação age sobre um produto: informe o código de barras', path: ['barras'] })
  .refine((d) => !OPERACOES_SEM_BARRAS.includes(d.operacao) || !d.barras,
    { message: 'esta operação age sobre o cupom inteiro: não informe código de barras', path: ['barras'] })
  // ⚠️ `PRECO` é preço absoluto — `tipo` preenchido o transformaria em desconto
  .refine((d) => d.operacao !== 'PRECO' || d.tipo == null,
    { message: 'em PRECO o valor é o preço em reais: não informe o tipo', path: ['tipo'] })
  .refine((d) => d.operacao !== 'PRECO' || (d.valor != null && d.valor > 0),
    { message: 'PRECO exige o preço do clube', path: ['valor'] })
  // ⚠️ `VARIAVEL` é desconto — sem `tipo` o valor fica ambíguo
  .refine((d) => d.operacao !== 'VARIAVEL' || d.tipo != null,
    { message: 'em VARIAVEL o valor é desconto: informe se é % ou $', path: ['tipo'] })
  // percentual não passa de 100
  .refine((d) => d.tipo !== '%' || d.valor == null || d.valor <= 100,
    { message: 'desconto percentual não pode passar de 100', path: ['valor'] })
  .refine((d) => !OPERACOES_COM_QTDE_PAGA.includes(d.operacao) || d.quantidade_paga != null,
    { message: 'esta operação exige a quantidade paga', path: ['quantidade_paga'] })
  // leve N pague M: pagar mais do que leva não é promoção
  .refine((d) => d.operacao !== 'LEVE_PAGUE'
      || (d.quantidade != null && d.quantidade_paga != null && d.quantidade_paga < d.quantidade),
    { message: 'em LEVE_PAGUE a quantidade paga tem de ser menor que a levada', path: ['quantidade_paga'] })
  .refine((d) => d.operacao !== 'DESCONTO_POR_PDV' || d.pdv != null,
    { message: 'DESCONTO_POR_PDV exige o PDV', path: ['pdv'] })
  .refine((d) => d.operacao !== 'CODIGO_PROMOCIONAL' || !!d.codigo_promocional,
    { message: 'CODIGO_PROMOCIONAL exige o código', path: ['codigo_promocional'] });
export type ClubeDescontoDto = z.infer<typeof clubeDescontoSchema>;

export const clubeDescontoConsultaSchema = z.object({
  q: z.string().trim().max(60).optional(),
  operacao: z.enum(OPERACOES_CLUBE).optional(),
  /** só o que vale agora (ativo, não encerrado e dentro da vigência) */
  vigentes: boolQuery(false),
  incluir_estornadas: boolQuery(false),
  limite: z.coerce.number().int().positive().max(2000).default(300),
});
export type ClubeDescontoConsultaDto = z.infer<typeof clubeDescontoConsultaSchema>;
