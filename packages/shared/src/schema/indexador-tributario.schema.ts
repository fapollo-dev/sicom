import { z } from 'zod';

/**
 * CADASTRO DO INDEXADOR TRIBUTÁRIO (`FRMCADINDEXADORTRIBUTARIO`, `uCadIndexadorTributario.pas`).
 *
 * Para cada combinação de **figura fiscal · tipo · origem · destino · CFOP** — e, dentro dela, EAN, NCM ou
 * fornecedor —, qual alíquota, MVA e redução aplicar. É de onde sai o ICMS-ST de toda entrada de nota.
 */

/** `F` fornecedor (11.550 no cliente) · `C` cliente (503). */
export const TIPOS_CADASTRO_INDEXADOR = ['F', 'C'] as const;
/**
 * a operação que define o CST — as 10 do legado (`cmbOperacao`, uCadIndexadorTributario.dfm:584; o motor já as conhece em
 * `cstDaOperacao`). Na produção: C 3.400 · F 3.162 · T 2.346 · N 1.687 · Z 782 · I 532 · R 162 · Y 8 · D 2 — o Apollo aceitava
 * só T/I/S/N/F e recusava a mais usada (C = CST 010).
 */
export const OPERACOES_INDEXADOR = ['T', 'R', 'Z', 'C', 'F', 'S', 'D', 'I', 'N', 'Y'] as const;
export const OPERACAO_INDEXADOR_ROTULO: Record<(typeof OPERACOES_INDEXADOR)[number], string> = {
  T: 'Tributado integralmente — CST 000', R: 'Reduzida tributada — CST 020', Z: 'Reduzida ST — CST 070', C: 'Substituição — CST 010 (com destaque de ST)',
  F: 'Substituição — CST 060 (sem destaque de ST)', S: 'Suspensão — CST 050', D: 'Diferimento — CST 051', I: 'Isenta — CST 040', N: 'Outras — CST 090',
  Y: 'Não tributada — CST 041',
};
/** o tipo da figura (`cmbTpFigura`, travado na tela): a CLASSIFICACAO do parceiro — F atacado, I indústria, C comércio, S Simples; vazio sem parceiro */
export const TIPOS_FIGURA_INDEXADOR = ['F', 'I', 'C', 'S', 'N'] as const;

export const indexadorTributarioSchema = z.object({
  tp_cadastro: z.enum(TIPOS_CADASTRO_INDEXADOR).default('F'),
  /** derivado da CLASSIFICACAO do parceiro quando há parceiro (`S` = Simples Nacional pula o MVA ajustado); vazio sem parceiro */
  tp_figura: z.preprocess((v) => (v === '' ? null : v), z.enum(TIPOS_FIGURA_INDEXADOR).nullish()),
  codfigurafiscal: z.coerce.number().int().nonnegative().nullish(),
  origem: z.string().trim().length(2).nullish(),
  destino: z.string().trim().length(2).nullish(),
  codcfop: z.coerce.number().int().positive().nullish(),
  operacao: z.enum(OPERACOES_INDEXADOR).nullish(),
  /** os três discriminadores do OR-null: quanto mais específico, mais peso no desempate. */
  codbarra: z.string().trim().max(30).nullish(),
  ncm: z.string().trim().max(10).nullish(),
  codparceiro: z.coerce.number().int().positive().nullish(),
  cnpj_cpf: z.string().trim().max(20).nullish(),
  aliquota_dest: z.coerce.number().min(0).max(100),
  icm_fonte: z.coerce.number().min(0).max(100).default(0),
  mva: z.coerce.number().min(0).max(999).default(0),
  /** % da base de ST (100 = sem redução). */
  redcom: z.coerce.number().min(0).max(100).default(100),
  /** % da alíquota-fonte no crédito (100 = sem redução). */
  reducao: z.coerce.number().min(0).max(100).default(100),
  aliquota_fem: z.coerce.number().min(0).max(100).default(0),
  st_externo: z.enum(['S', 'N']).default('N'),
  basesemreducao: z.enum(['S', 'N']).nullish(),
  base_st_com_reducao: z.enum(['S', 'N']).nullish(),
  aliquota_fonte_lei_3166: z.enum(['S', 'N']).nullish(),
  aliquota_reduzida_lei_3166: z.coerce.number().min(0).max(100).nullish(),
  considerar_desconto_calc_st: z.enum(['S', 'N']).nullish(),
})
  // ⚠️ um indexador sem NENHUM discriminador casaria com tudo — o OR-null o tornaria curinga universal
  .refine((i) => !!i.codbarra || !!i.ncm || i.codparceiro != null, {
    message: 'informe ao menos um entre EAN, NCM e fornecedor', path: ['ncm'],
  });

export const filtroIndexadorSchema = z.object({
  ncm: z.string().trim().max(10).optional(),
  codbarra: z.string().trim().max(30).optional(),
  codparceiro: z.coerce.number().int().positive().optional(),
  codcfop: z.coerce.number().int().positive().optional(),
  tp_cadastro: z.enum(TIPOS_CADASTRO_INDEXADOR).optional(),
  incluirExcluidos: z.enum(['S', 'N']).default('N'),
  limite: z.coerce.number().int().positive().max(5000).default(500),
});

export type IndexadorTributarioDto = z.infer<typeof indexadorTributarioSchema>;
export type FiltroIndexadorDto = z.infer<typeof filtroIndexadorSchema>;
