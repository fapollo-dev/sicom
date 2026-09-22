import { z } from 'zod';
import { boolQuery } from './bool-query';

/**
 * REFORMA TRIBUTÁRIA IBS/CBS — os cadastros (`FRMCADCSTIBSCBS` e `FRMCADCLASSTRIBIBSCBS`).
 * Migration 278. O fonte clonado é de mai/2020 e a reforma é de 2023+: o material é o dado da produção.
 */

const sn = () => z.enum(['S', 'N']);

/** normaliza o tipo de alíquota: minúsculo, sem diacrítico — o valor vem de carga e pode perder o acento */
export const normalizaTipoAliquota = (v: unknown) =>
  String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/**
 * Os cinco tipos que a LC 214/2025 produz, e que decidem COMO o item se calcula.
 * Distribuição nas 132 classificações do cliente: Padrão 60 · Sem alíquota 55 · Uniforme setorial 8 ·
 * Uniforme nacional (referência) 5 · Fixa 4.
 */
export const TIPOS_ALIQUOTA_CONHECIDOS = new Set([
  'padrao', 'sem aliquota', 'uniforme setorial', 'uniforme nacional (referencia)', 'fixa',
]);
const flag = () => z.coerce.number().int().min(0).max(1);

/** CST da reforma: 3 dígitos (000, 010, 011, 200, 210, 220…). */
export const cstIbsCbsSchema = z.object({
  cst: z.string().trim().regex(/^\d{3}$/, 'CST tem 3 dígitos'),
  descricao_cst: z.string().trim().min(1).max(255),
  // indicadores de GRUPO: que blocos do XML a CST habilita
  ind_gibscbs: flag().default(0),
  ind_gibscbsmono: flag().default(0),
  ind_gred: flag().default(0),
  ind_gdif: flag().default(0),
  ind_gtranf_cred: flag().default(0),
  // por DOCUMENTO fiscal — são 9 flags independentes, não uma: a mesma CST vale para NF-e e não para CT-e
  ind_nfe: sn().default('N'),
  ind_nfce: sn().default('N'),
  ind_cte: sn().default('N'),
  ind_cteos: sn().default('N'),
  ind_bpe: sn().default('N'),
  ind_bpetm: sn().default('N'),
  ind_nf3e: sn().default('N'),
  ind_nfcom: sn().default('N'),
  ind_nfse: sn().default('N'),
});
export type CstIbsCbsDto = z.infer<typeof cstIbsCbsSchema>;

/**
 * Classificação tributária (cClassTrib, 6 dígitos) da LC 214/2025.
 *
 * ⚠️ `pred_ibs` e `pred_cbs` são INDEPENDENTES. No cliente há classificação com 60 no IBS e 100 na CBS;
 * colapsar os dois num percentual só erra essa linha em silêncio, cobrando imposto a mais.
 */
export const classTribSchema = z.object({
  cst: z.string().trim().regex(/^\d{3}$/, 'CST tem 3 dígitos'),
  descricao_cst: z.string().trim().min(1).max(255),
  class_trib: z.string().trim().regex(/^\d{6}$/, 'cClassTrib tem 6 dígitos'),
  nome_class_trib: z.string().trim().min(1).max(500),
  descricao_class_trib: z.string().trim().nullable().optional(),
  lc_redacao: z.string().trim().nullable().optional(),
  lc_214_25: z.string().trim().max(100).nullable().optional(),
  /**
   * ⚠️ NÃO é rótulo: é o campo que GOVERNA A FÓRMULA (mig 280). Só "Padrão" se calcula pela alíquota da
   * UF; "Sem alíquota" não tributa; setorial, nacional e fixa têm cálculo próprio. Por isso é obrigatório
   * e fechado num conjunto — texto livre aqui vira imposto errado, e vazio faria a nota inteira ser
   * recusada. A comparação aceita com e sem acento porque o valor vem de carga (ver `semAcento` no
   * serviço).
   */
  tipo_aliquota: z.string().trim().min(1, 'informe o tipo de alíquota').max(500)
    .refine((v) => TIPOS_ALIQUOTA_CONHECIDOS.has(normalizaTipoAliquota(v)),
      { message: 'tipo de alíquota desconhecido — governa a fórmula do IBS/CBS e não pode ser texto livre' }),
  pred_ibs: z.coerce.number().min(0).max(100).nullable().optional(),
  pred_cbs: z.coerce.number().min(0).max(100).nullable().optional(),
  ind_redutor_bc: z.string().trim().max(3).nullable().optional(),
  ind_gtrib_regular: flag().nullable().optional(),
  ind_cred_pres: flag().nullable().optional(),
  ind_mono: flag().nullable().optional(),
  ind_mono_reten: flag().nullable().optional(),
  ind_mono_ret: flag().nullable().optional(),
  ind_mono_dif: flag().nullable().optional(),
  credito_para: z.string().trim().max(500).nullable().optional(),
  // vazias nas 132 do cliente; o leiaute as prevê e a carga precisa de destino
  d_ini_vig: z.string().trim().date().nullable().optional(),
  d_fim_vig: z.string().trim().date().nullable().optional(),
});
export type ClassTribDto = z.infer<typeof classTribSchema>;

/** consulta das duas telas: trecho do código, do nome ou da CST. */
export const reformaConsultaSchema = z.object({
  q: z.string().trim().max(120).optional(),
  cst: z.string().trim().regex(/^\d{3}$/).optional(),
  /** só as que valem para NF-e (o filtro que a tela 145 usa por padrão) */
  so_nfe: boolQuery(false),
  incluir_estornadas: boolQuery(false),
  limite: z.coerce.number().int().positive().max(2000).default(300),
});
export type ReformaConsultaDto = z.infer<typeof reformaConsultaSchema>;

/** de-para cClassTrib × NCM por anexo da LC 214/2025: consulta pelo NCM do produto. */
export const cclassTribNcmConsultaSchema = z.object({
  ncm: z.string().trim().regex(/^\d{2,8}$/, 'informe de 2 a 8 dígitos do NCM').optional(),
  cclass_trib: z.string().trim().regex(/^\d{6}$/).optional(),
  anexo: z.string().trim().max(10).optional(),
  limite: z.coerce.number().int().positive().max(2000).default(300),
});
export type CclassTribNcmConsultaDto = z.infer<typeof cclassTribNcmConsultaSchema>;

/** alíquota de IBS por UF (hoje 0,1 nas 27 do cliente). */
export const ibsUfSchema = z.object({
  uf: z.string().trim().length(2).toUpperCase(),
  valor_ibs_uf: z.coerce.number().min(0).max(100),
});
export type IbsUfDto = z.infer<typeof ibsUfSchema>;

/** corte-2 (mig 279): recalcular os grupos IBS/CBS de uma nota. */
export const nfIbsCbsCalculoSchema = z.object({
  codnf: z.coerce.number().int().positive(),
  /** deixa passar item cujo produto não tem classificação (grava o item com CST nula). */
  // body JSON, não query: `z.boolean()` mesmo — `z.coerce.boolean()` faria a string "false" virar true
  permitir_sem_classificacao: z.boolean().default(false),
});
export type NfIbsCbsCalculoDto = z.infer<typeof nfIbsCbsCalculoSchema>;

/** consulta dos grupos de uma nota, com o par de conferência (o que o fornecedor mandou × o que ficou). */
export const nfIbsCbsConsultaSchema = z.object({
  codnf: z.coerce.number().int().positive(),
  so_divergentes: boolQuery(false),
});
export type NfIbsCbsConsultaDto = z.infer<typeof nfIbsCbsConsultaSchema>;

/** corte-3 (mig 281): apuração de IBS/CBS por competência. */
export const apuracaoIbsCbsProcessarSchema = z.object({
  /** AAAAMM */
  competencia: z.string().trim().regex(/^\d{6}$/, 'competência no formato AAAAMM')
    .refine((v) => { const m = Number(v.slice(4)); return m >= 1 && m <= 12; }, 'mês inválido'),
  /** reprocessar apaga o detalhe e recalcula; apuração FECHADA nunca é reprocessada */
  reprocessar: z.boolean().default(false),
});
export type ApuracaoIbsCbsProcessarDto = z.infer<typeof apuracaoIbsCbsProcessarSchema>;

export const apuracaoIbsCbsObterSchema = z.object({
  competencia: z.string().trim().regex(/^\d{6}$/).optional(),
  limite_detalhe: z.coerce.number().int().positive().max(5000).default(500),
});
export type ApuracaoIbsCbsObterDto = z.infer<typeof apuracaoIbsCbsObterSchema>;

/** corte-7 (mig 284): split payment — o imposto separado na liquidação. */
export const splitPaymentGerarSchema = z.object({
  codnf: z.coerce.number().int().positive(),
  /** só na modalidade manual: o valor que o contribuinte informa separar */
  ibs_manual: z.coerce.number().min(0).optional(),
  cbs_manual: z.coerce.number().min(0).optional(),
});
export type SplitPaymentGerarDto = z.infer<typeof splitPaymentGerarSchema>;

export const splitPaymentConfigSchema = z.object({
  modalidade: z.enum(['inteligente', 'simplificada', 'manual']),
  perc_simplificado: z.coerce.number().min(0).max(100).default(0),
  ativo: z.enum(['S', 'N']).default('N'),
  vigencia_inicio: z.string().trim().date().nullable().optional(),
  fonte: z.string().trim().max(200).nullable().optional(),
});
export type SplitPaymentConfigDto = z.infer<typeof splitPaymentConfigSchema>;

export const splitPaymentConsultaSchema = z.object({
  competencia: z.string().trim().regex(/^\d{6}$/).optional(),
  codnf: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().max(2000).default(300),
});
export type SplitPaymentConsultaDto = z.infer<typeof splitPaymentConsultaSchema>;
