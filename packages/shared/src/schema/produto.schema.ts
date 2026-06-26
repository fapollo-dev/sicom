import { z } from 'zod';
import { soDigitos } from '../validators/br';
import { eanValido } from '../validators/codigo-barras';

/**
 * Cadastro de PRODUTO (hub do ERP) — Fase 1: NÚCLEO fiel. A tela ARMAZENA config
 * (identidade + fiscal + unidade/balança + códigos de barras); NÃO calcula preço/imposto
 * (o motor já portado vive em apps/api/src/modules/precificacao, reusado em F2).
 * Doc: docs/04-screen-dossier/dossiers/retaguarda/UCadProduto.md
 *
 * Achados refletidos do legado (UCadProduto.pas):
 *  - CODBARRA obrigatório, sem '*' (edtCODBARRAExit) e, quando tem 13 dígitos, deve ser
 *    EAN-13 válido (CalculaDVCodBarra). PLU/códigos internos mais curtos não forçam EAN.
 *  - DESCRICAO obrigatória, sem ';' nem '|' (delimitadores de export do legado).
 *  - UNIDADE / CODFOR (fornecedor) / ALIQUOTA obrigatórios.
 *  - NCM com 8 dígitos; CEST com 7 dígitos e OBRIGATÓRIO quando a alíquota é 'STB' (ST).
 * Mensagens em PT (ADR-015). PRODUTOS é GLOBAL (sem IDEMPRESA → NÃO empresaScoped).
 */

/** ORIGEM da mercadoria (CST origem 0-8) — combo do legado (cmbORIGEM). */
export const ORIGEM_OPCOES = [
  { value: '0', label: '0 - Nacional' },
  { value: '1', label: '1 - Estrangeira - importação direta' },
  { value: '2', label: '2 - Estrangeira - adquirida no mercado interno' },
  { value: '3', label: '3 - Nacional, conteúdo de importação superior a 40%' },
  { value: '4', label: '4 - Nacional, produção conforme processos produtivos básicos' },
  { value: '5', label: '5 - Nacional, conteúdo de importação inferior ou igual a 40%' },
  { value: '6', label: '6 - Estrangeira - importação direta, sem similar nacional' },
  { value: '7', label: '7 - Estrangeira - mercado interno, sem similar nacional' },
  { value: '8', label: '8 - Nacional, conteúdo de importação superior a 70%' },
] as const;

const ORIGEM_VALUES = ORIGEM_OPCOES.map((o) => o.value) as [string, ...string[]];

/** trata '' / null como ausente (campo opcional) antes de aplicar um validador. */
const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

const sn = (msg = "Informe 'S' ou 'N'") => z.enum(['S', 'N'], { message: msg });

/**
 * CODBARRA (edtCODBARRAExit): obrigatório, sem '*', e EAN-13 válido quando o valor
 * normalizado tem 13 dígitos. PLU de balança / código interno mais curto passa.
 */
const codbarra = z
  .string({ message: 'Informe o código de barras!' })
  .trim()
  .min(1, 'Informe o código de barras!')
  .max(14)
  .refine((v) => !v.includes('*'), {
    message: 'Não é permitido o uso do caractere (*) no código de barras.',
  })
  .refine((v) => soDigitos(v).length !== 13 || eanValido(soDigitos(v)), {
    message: 'Código de barras (EAN-13) inválido.',
  });

/** DESCRICAO (edtDESCRICAOExit): obrigatória, máx. 120, sem ';' nem '|'. */
const descricao = z
  .string({ message: 'Informe a descrição do produto.' })
  .trim()
  .min(1, 'Informe a descrição do produto.')
  .max(120, 'A descrição deve ter no máximo 120 caracteres.')
  .refine((v) => !v.includes(';'), { message: "A descrição do produto não pode conter o caractere ';'." })
  .refine((v) => !v.includes('|'), { message: "A descrição do produto não pode conter o caractere '|'." });

/** Código de barras auxiliar / embalagem (detalhe 1:N — CODAUXILIAR). */
export const codAuxiliarSchema = z.object({
  codauxiliar: z.string().trim().max(14).optional(),
  codbarra: z.string().trim().max(14).optional(),
  fatoremb: z.number().nonnegative('Fator de embalagem inválido').optional(),
  codunidade: z.number().int().optional(),
  operacao: z.string().trim().max(1).optional(),
});
export type CodAuxiliarDto = z.infer<typeof codAuxiliarSchema>;

/** Base do master (sem o superRefine) — reusada p/ o schema de atualização (partial). */
const produtoBase = z.object({
  // identidade
  codbarra,
  descricao,
  descricao_resumida: z.string().trim().max(60).optional(),
  descricao_web: z.string().trim().max(200).optional(),
  descricao_balanca: z.string().trim().max(60).optional(),
  // unidade
  unidade: z.string({ message: 'Informe a unidade.' }).trim().min(1, 'Informe a unidade.').max(2),
  codunidade: z.number().int().optional(),
  // fornecedor (FRN) — obrigatório
  codfor: z.number({ message: 'Informe o fornecedor.' }).int('Informe o fornecedor.'),
  // classificação (→ familias_prod / marcas)
  idmarca: z.number().int().optional(),
  codgrupo: z.number().int().optional(),
  codsubgrupo: z.number().int().optional(),
  coddpto: z.number().int().optional(),
  codsecao: z.number().int().optional(),
  codgrupopreco: z.number().int().optional(),
  // config fiscal (armazenada; cálculo vive em precificacao)
  ncmsh: opcional(
    z
      .string()
      .trim()
      .refine((v) => soDigitos(v).length === 8, { message: 'O NCM deve ter 8 dígitos.' }),
  ),
  cest: opcional(
    z
      .string()
      .trim()
      .refine((v) => soDigitos(v).length === 7, { message: 'O CEST deve ter 7 dígitos.' }),
  ),
  cest_obrigatorio: sn().optional(),
  aliquota: z.string({ message: 'Informe a alíquota.' }).trim().min(1, 'Informe a alíquota.').max(3),
  idpiscofins: z.number().int().optional(),
  codfigurafiscal: z.number().int().optional(),
  codfcp: z.number().int().optional(),
  mva: z.number().nonnegative('MVA inválido').optional(),
  origemprod: opcional(z.enum(ORIGEM_VALUES, { message: 'Origem inválida.' })),
  // unidade/balança/validade
  balanca: sn().default('N'),
  codbalanca: z.number().int().optional(),
  fatorkg: z.number().nonnegative('Fator KG inválido').optional(),
  peso: z.number().nonnegative('Peso inválido').optional(),
  fatorcx: z.number().int().optional(),
  validade: z.number().int().optional(),
  controle_validade: sn().default('S'),
  // controle / auto-relacionamento
  ativo: sn().default('S'),
  ativo_compra: sn().default('S'),
  idproduto_pai: z.number().int().optional(),
  fator_filho: z.number().nonnegative('Fator do filho inválido').optional(),
  // detalhe 1:N (engine de agregado grava todos numa transação)
  codauxiliares: z.array(codAuxiliarSchema).optional().default([]),
});

/** Regra do legado (btnGravarClick): CEST é obrigatório quando a alíquota é do tipo 'STB' (ST). */
export const produtoSchema = produtoBase.superRefine((d, ctx) => {
  if (d.aliquota === 'STB' && !(d.cest && d.cest.trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Para alíquota do tipo "STB", a informação do CEST é obrigatória.',
      path: ['cest'],
    });
  }
});
export type CriarProdutoDto = z.infer<typeof produtoSchema>;

export const atualizarProdutoSchema = produtoBase.partial();
export type AtualizarProdutoDto = z.infer<typeof atualizarProdutoSchema>;

export interface Produto extends CriarProdutoDto {
  idproduto: number;
  marca?: string; // decode (via view), p/ exibição
  grupo?: string; // idem
  fornecedor?: string; // idem
}

/* ─────────────────────────  Lookups de apoio (catálogos)  ───────────────────────── */

/** UNIDADE (catálogo). SIGLA obrigatória (máx. 6). */
export const unidadeSchema = z.object({
  sigla: z.string().trim().min(1, 'Informe a sigla.').max(6, 'Sigla deve ter no máximo 6 caracteres.'),
  descricao: z.string().trim().max(60).optional(),
});
export type CriarUnidadeDto = z.infer<typeof unidadeSchema>;
export const atualizarUnidadeSchema = unidadeSchema.partial();
export type AtualizarUnidadeDto = z.infer<typeof atualizarUnidadeSchema>;
export interface Unidade extends CriarUnidadeDto {
  codunidade: number;
}

/** FAMILIAS_PROD (catálogo único com discriminador TIPO: G/S/D/O/R). */
export const FAMILIA_TIPO_OPCOES = [
  { value: 'G', label: 'Grupo' },
  { value: 'S', label: 'Subgrupo' },
  { value: 'D', label: 'Departamento' },
  { value: 'O', label: 'Seção' },
  { value: 'R', label: 'Grupo de preço' },
] as const;

export const familiaSchema = z.object({
  tipo: z.enum(['G', 'S', 'D', 'O', 'R'], { message: 'Tipo de família inválido.' }),
  descricao: z.string().trim().max(60).optional(),
});
export type CriarFamiliaDto = z.infer<typeof familiaSchema>;
export const atualizarFamiliaSchema = familiaSchema.partial();
export type AtualizarFamiliaDto = z.infer<typeof atualizarFamiliaSchema>;
export interface Familia extends CriarFamiliaDto {
  codfamilia: number;
}

/** ALIQUOTA (catálogo dos códigos fiscais; CHAVE NATURAL CODIGO char(3)). */
export const aliquotaSchema = z.object({
  codigo: z.string().trim().min(1, 'Informe o código da alíquota.').max(3, 'Código deve ter no máximo 3 caracteres.'),
  descricao: z.string().trim().max(60).optional(),
});
export type CriarAliquotaDto = z.infer<typeof aliquotaSchema>;
export const atualizarAliquotaSchema = aliquotaSchema.partial();
export type AtualizarAliquotaDto = z.infer<typeof atualizarAliquotaSchema>;
export interface Aliquota extends CriarAliquotaDto {}
