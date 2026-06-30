import { z } from 'zod';

/**
 * NOTA FISCAL (tela-coroa do ERP) — Fase 1: NÚCLEO CADASTRO, SEM EFEITOS.
 * A tela ARMAZENA o documento (header + itens NF_PROD + config fiscal por item + status
 * inicial). NÃO move estoque, NÃO gera financeiro, NÃO contabiliza, NÃO transmite (SEFAZ) —
 * isso é F3..F6 (ver dossiê uNF.md §0/§6/§8). O cálculo fiscal reusa `precificacao` em F2.
 *
 * Achados do legado refletidos aqui (uNF.pas / udmNF.pas):
 *  - TIPO 'E'/'S' (entrada/saída) — a mesma tela, parametrizada (ConfiguraNota 35/36).
 *  - DTCONTABIL não pode ser MENOR que DTEMISSAO (btnGravar).
 *  - CODPARCEIRO (fornecedor/cliente) obrigatório.
 *  - Terceiros Modelo 55 (TIPOEMISSAO='1' + MODELO=55) não pode ser digitada manualmente
 *    (vem de XML) — bloqueado.
 * Mensagens em PT (ADR-015). NF é empresaScoped (IDEMPRESA carimbado pelo engine).
 */

/* ───────────────────────────  helpers (idem produto.schema)  ─────────────────────────── */

/** trata '' / null como ausente antes de aplicar um validador. */
const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

const sn = (msg = "Informe 'S' ou 'N'") => z.enum(['S', 'N'], { message: msg });

/**
 * Campo DECIMAL tolerante: a API devolve `numeric` do Postgres como STRING; ao reabrir p/
 * edição o form carrega a string. Aceita número OU string numérica e normaliza ('' / null →
 * ausente) ANTES de validar — torna o schema IDEMPOTENTE com a própria saída da API.
 */
const dec = (inner: z.ZodNumber = z.number()) =>
  z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  }, inner.optional());

/** remove `null` (→ ausente), recursivo (cobre os arrays de itens/referências). */
const stripNulls = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const x = stripNulls(val);
      if (x !== undefined) o[k] = x;
    }
    return o;
  }
  return v === null ? undefined : v;
};

/* ───────────────────────────────────  combos  ─────────────────────────────────── */

export const NF_TIPO_OPCOES = [
  { value: 'E', label: 'Entrada' },
  { value: 'S', label: 'Saída' },
] as const;

export const NF_FINALIDADE_OPCOES = [
  { value: '1', label: '1 - Normal' },
  { value: '2', label: '2 - Complementar' },
  { value: '3', label: '3 - Ajuste' },
  { value: '4', label: '4 - Devolução' },
] as const;

export const NF_TIPOEMISSAO_OPCOES = [
  { value: '0', label: 'Própria' },
  { value: '1', label: 'Terceiros' },
] as const;

/** Modelos por tipo (saída vs entrada) — espelha as listas distintas do legado (ConfiguraNota). */
export const NF_MODELO_OPCOES_SAIDA = [
  { value: 55, label: '55 - NF-e' },
  { value: 65, label: '65 - NFC-e' },
  { value: 1, label: '01 - Nota Fiscal' },
  { value: 2, label: '02 - Nota Fiscal de Venda a Consumidor' },
] as const;

export const NF_MODELO_OPCOES_ENTRADA = [
  { value: 55, label: '55 - NF-e' },
  { value: 1, label: '01 - Nota Fiscal' },
  { value: 4, label: '04 - Nota Fiscal de Produtor' },
  { value: 6, label: '06 - Conta de Energia Elétrica' },
  { value: 7, label: '07 - Conhecimento de Transporte' },
] as const;

/* ─────────────────────────────────  detalhes 1:N  ───────────────────────────────── */

/**
 * Item da NF (NF_PROD). config fiscal ARMAZENADA (o cálculo entra em F2). CODPRODUTO e
 * QUANTIDADE são obrigatórios (item sem produto/qtde é rejeitado — paridade btnAddItem).
 */
export const nfItemSchema = z.object({
  nroitem: z.number().int().optional(),
  codproduto: z.number({ message: 'Informe o produto do item.' }).int('Produto inválido.'),
  codprodnota: z.string().trim().max(25).optional(),
  quantidade: z.preprocess(
    (v) => (typeof v === 'string' ? Number(v) : v),
    z.number({ message: 'Informe a quantidade do item.' }).positive('A quantidade deve ser maior que zero.'),
  ),
  fatorembal: dec(z.number().positive('Fator de embalagem inválido')),
  unidade: z.string().trim().max(2).optional(),
  // F3 — guardas de movimento de estoque (default 'S' no banco); permitem item que não move físico
  geraestoque: sn().optional(),
  movimenta_estoque: sn().optional(),
  vrvenda: dec(z.number().nonnegative('Valor de venda inválido')),
  vrcusto: dec(z.number().nonnegative('Custo inválido')),
  desconto: dec(z.number().nonnegative('Desconto inválido')),
  vrdescprod: dec(z.number().nonnegative('Desconto inválido')),
  bonificacao: dec(z.number().nonnegative('Bonificação inválida')),
  // config fiscal (armazenada)
  cfop: z.string().trim().max(4).optional(),
  ncm: opcional(z.string().trim().max(30)),
  cest: opcional(z.string().trim().max(20)),
  origem_estoque: z.string().trim().max(2).optional(),
  aliquota: z.string().trim().max(3).optional(),
  icms: dec(z.number().nonnegative('Alíquota de ICMS inválida')),
  cst: z.number().int().optional(),
  csosn: z.string().trim().max(3).optional(),
  bcr: dec(z.number().nonnegative()), // % base reduzida ICMS (F2: resolvido de det_aliquota)
  vrbasecalculo: dec(z.number().nonnegative()),
  vricm: dec(z.number().nonnegative()),
  icme: dec(z.number().nonnegative()),
  mva: dec(z.number().nonnegative()),
  vrbasest: dec(z.number().nonnegative()),
  vricmst: dec(z.number().nonnegative()),
  streal: dec(z.number().nonnegative()),
  ipi: dec(z.number().nonnegative()), // alíquota IPI %
  vripi: dec(z.number().nonnegative()), // valor do IPI (F2: TOTALPRODS * ipi% / 100)
  // flags GERAICM_* (compõem a base do ICMS próprio na F2); default 'N' no banco
  geraicm_ipi: sn().optional(),
  geraicm_frete: sn().optional(),
  geraicm_acess: sn().optional(),
  fcp_aliquota: dec(z.number().nonnegative()),
  fcp_valor: dec(z.number().nonnegative()),
  pis: z.string().trim().max(1).optional(),
  cstpiscofins: z.string().trim().max(3).optional(),
  aliqpise: dec(z.number().nonnegative()),
  aliqpiss: dec(z.number().nonnegative()),
  aliqcofinse: dec(z.number().nonnegative()),
  aliqcofinss: dec(z.number().nonnegative()),
  frete: dec(z.number().nonnegative()),
  seguro: dec(z.number().nonnegative()),
  vroutrasdesp: dec(z.number().nonnegative()),
});
export type NfItemDto = z.infer<typeof nfItemSchema>;

/** NF referenciada (devolução/complemento). */
export const nfReferenciaSchema = z.object({
  codnf_ref: z.number().int().optional(),
  chave_ref: opcional(z.string().trim().max(44)),
  valor_ref: dec(z.number().nonnegative()),
});
export type NfReferenciaDto = z.infer<typeof nfReferenciaSchema>;

/* ───────────────────────────────────  header  ─────────────────────────────────── */

const nfBase = z.object({
  // identificação (MODELO/SERIE/DTCONTABIL obrigatórios — NOT NULL no Oracle, digitados na F1)
  tipo: z.enum(['E', 'S'], { message: 'Tipo de nota inválido (E/S).' }),
  modelo: z.number({ message: 'Informe o modelo da nota.' }).int('Modelo inválido.'),
  nronf: opcional(z.string().trim().max(12)),
  serie: z.string({ message: 'Informe a série.' }).trim().min(1, 'Informe a série.').max(3),
  dtemissao: z.string({ message: 'Informe a data de emissão.' }).trim().min(1, 'Informe a data de emissão.'),
  dtcontabil: z
    .string({ message: 'Informe a data de contabilização.' })
    .trim()
    .min(1, 'Informe a data de contabilização.'),
  dtchegada: opcional(z.string().trim()),
  dthorasaida: opcional(z.string().trim()),
  tipoemissao: opcional(z.enum(['0', '1'])),
  finalidade: opcional(z.enum(['1', '2', '3', '4'])),
  cfop: opcional(z.string().trim().max(4)),
  idsituacao_nf: z.number().int().optional(),
  codparceiro: z.number({ message: 'Favor informar o código do fornecedor.' }).int('Favor informar o código do fornecedor.'),
  codparceiro_end: z.number().int().optional(),
  indicador_presenca: z.string().trim().max(1).optional(),
  versaoxml: z.string().trim().max(10).optional(),
  // transporte / volumes
  codtransp: z.number().int().optional(),
  codtransp_end: z.number().int().optional(),
  tipofrete: z.string().trim().max(1).optional(),
  placatransp: opcional(z.string().trim().max(10)),
  ufplacatransp: opcional(z.string().trim().max(2)),
  especie: opcional(z.string().trim().max(30)),
  marca: opcional(z.string().trim().max(30)),
  numerotransp: opcional(z.string().trim().max(30)),
  qtdetransp: dec(z.number().nonnegative()),
  pesobruto: dec(z.number().nonnegative()),
  pesoliquido: dec(z.number().nonnegative()),
  // totais (server-authoritative via derivar; aceitos no payload p/ round-trip)
  totalnf: dec(z.number().nonnegative()),
  totalprod: dec(z.number().nonnegative()),
  totaldesc: dec(z.number().nonnegative()),
  totalfrete: dec(z.number().nonnegative()),
  totalseguro: dec(z.number().nonnegative()),
  totalacessorias: dec(z.number().nonnegative()),
  totalicm: dec(z.number().nonnegative()),
  totalbaseicm: dec(z.number().nonnegative()),
  totalipi: dec(z.number().nonnegative()),
  totalicm_st: dec(z.number().nonnegative()),
  totalisento: dec(z.number().nonnegative()),
  // estado (eixos A/B) — defaults no create; as travas de edição rodam no servidor (validar)
  proc: sn().optional(),
  statusnfe: opcional(z.string().trim().max(1)),
  cancelada: sn().optional(),
  confirmada: sn().optional(),
  contabilizado: sn().optional(),
  // contrato NFe (vazio na F1)
  chavenfe: opcional(z.string().trim().max(44)),
  protocolo_nfe: opcional(z.string().trim().max(20)),
  protocolo_cancelamento: opcional(z.string().trim().max(20)),
  xjust: opcional(z.string().trim().max(255)),
  sequencia_nfe: z.number().int().optional(),
  tpemissao: z.number().int().optional(),
  // flags
  faturada: sn().optional(), // F4: financeiro gerado (server-controlled; fora das colunas do agregado)
  rateio: sn().optional(),
  contribuinte_icms: z.string().trim().max(1).optional(),
  aproveitamentocredito: z.string().trim().max(1).optional(),
  alteraestoquereversao: sn().optional(),
  codnf_ref: z.number().int().optional(),
  // observações
  obs: opcional(z.string().trim().max(4000)),
  obsnf: opcional(z.string().trim().max(4000)),
  complemento: opcional(z.string().trim().max(4000)),
  // detalhes (engine grava todos numa transação)
  itens: z.array(nfItemSchema).optional().default([]),
  referencias: z.array(nfReferenciaSchema).optional().default([]),
});

/** DTCONTABIL não pode ser MENOR que DTEMISSAO (btnGravar). */
const validaDatas = (d: { dtemissao?: string; dtcontabil?: string }, ctx: z.RefinementCtx) => {
  if (d.dtemissao && d.dtcontabil) {
    const emi = new Date(d.dtemissao).getTime();
    const cont = new Date(d.dtcontabil).getTime();
    if (!Number.isNaN(emi) && !Number.isNaN(cont) && cont < emi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Data da contabilização MENOR que a data de emissão. Verifique!',
        path: ['dtcontabil'],
      });
    }
  }
};

/** Terceiros Modelo 55 não pode ser digitada manualmente (vem de XML). */
const validaTerceirosM55 = (d: { tipoemissao?: string; modelo?: number }, ctx: z.RefinementCtx) => {
  if (d.tipoemissao === '1' && Number(d.modelo) === 55) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'Não é permitido inserir manualmente notas fiscais de terceiros, Modelo 55. Importe ou Recupere o XML.',
      path: ['modelo'],
    });
  }
};

export const nfSchema = z.preprocess(stripNulls, nfBase).superRefine((d, ctx) => {
  validaDatas(d, ctx);
  validaTerceirosM55(d, ctx);
  if (!d.itens || d.itens.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Nota fiscal sem itens informados. Verifique.',
      path: ['itens'],
    });
  }
});
export type CriarNfDto = z.infer<typeof nfSchema>;

export const atualizarNfSchema = z.preprocess(stripNulls, nfBase.partial()).superRefine((d, ctx) => {
  validaDatas(d as { dtemissao?: string; dtcontabil?: string }, ctx);
  validaTerceirosM55(d as { tipoemissao?: string; modelo?: number }, ctx);
});
export type AtualizarNfDto = z.infer<typeof atualizarNfSchema>;

/**
 * F4 — body do faturamento (POST /fiscal/nf/:id/faturar). Condição de pagamento: nº de parcelas,
 * 1º vencimento (ISO) e intervalo em dias entre parcelas. (O legado deriva de PARCEIROS.diasprazo/
 * venc_prev; aqui os parâmetros vêm na chamada — corte 1 F4.)
 */
export const faturarNfSchema = z.object({
  numParcelas: z
    .number({ message: 'Informe o número de parcelas.' })
    .int('Número de parcelas inválido.')
    .min(1, 'Número de parcelas inválido.')
    .max(200, 'Máximo de 200 parcelas.'),
  primeiroVencimento: z
    .string({ message: 'Informe o primeiro vencimento.' })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD).'),
  intervaloDias: z.number().int().min(0).default(30),
});
export type FaturarNfDto = z.infer<typeof faturarNfSchema>;

/**
 * F2 — body do recálculo fiscal (POST /fiscal/nf/recalcular). É o dto da NF (header + itens),
 * sem o superRefine de gravação (não exige ≥1 item p/ ser robusto) — só valida formato e
 * exige codparceiro (p/ resolver a UF) e tipo. NÃO grava; só calcula e devolve enriquecido.
 */
export const recalcularNfSchema = z.preprocess(stripNulls, nfBase);
export type RecalcularNfDto = z.infer<typeof recalcularNfSchema>;

export interface Nf extends CriarNfDto {
  codnf: number;
  idempresa?: number;
  parceiro?: string; // decode (via view)
  situacao?: string;
}

/* ─────────────────────────  Lookups de apoio (catálogos)  ───────────────────────── */

/** SITUACAO_NF — "natureza do documento" (chave natural idsituacao_nf). */
export const situacaoNfSchema = z.object({
  idsituacao_nf: z.number({ message: 'Informe o código da situação.' }).int('Código inválido.'),
  descricao: z.string().trim().min(1, 'Informe a descrição.').max(80),
  tipo: opcional(z.enum(['E', 'S'])),
});
export type CriarSituacaoNfDto = z.infer<typeof situacaoNfSchema>;
export const atualizarSituacaoNfSchema = situacaoNfSchema.partial();
export type AtualizarSituacaoNfDto = z.infer<typeof atualizarSituacaoNfSchema>;
export interface SituacaoNf extends CriarSituacaoNfDto {}

/** CFOP — catálogo (chave natural codcfop char(4)). */
export const cfopSchema = z.object({
  codcfop: z.string().trim().min(4, 'O CFOP deve ter 4 dígitos.').max(4, 'O CFOP deve ter 4 dígitos.'),
  descricao: z.string().trim().min(1, 'Informe a descrição.').max(120),
});
export type CriarCfopDto = z.infer<typeof cfopSchema>;
export const atualizarCfopSchema = cfopSchema.partial();
export type AtualizarCfopDto = z.infer<typeof atualizarCfopSchema>;
export interface Cfop extends CriarCfopDto {}
