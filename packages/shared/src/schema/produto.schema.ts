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
 * Campo DECIMAL tolerante: a API retorna colunas `numeric` do Postgres como STRING
 * (ex.: '4.5500'); ao reabrir o registro p/ edição, o form carrega a string. Este helper
 * aceita número OU string numérica e normaliza ('' / null → ausente) ANTES de validar —
 * sem ele, `z.number()` reprovaria a gravação na edição (campo não tocado fica string).
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
  fatoremb: dec(z.number().nonnegative('Fator de embalagem inválido')),
  codunidade: z.number().int().optional(),
  operacao: z.string().trim().max(1).optional(),
});
export type CodAuxiliarDto = z.infer<typeof codAuxiliarSchema>;

/**
 * Preço/custo POR EMPRESA (detalhe 1:N — MULTI_PRECO). No legado fica na MESMA form do
 * produto. O VRVENDA é o resultado do cálculo (custo+markup+impostos), REUSADO de
 * POST /precificacao/produto — a tela só ARMAZENA o resultado por empresa.
 */
export const precoProdutoSchema = z.object({
  idempresa: z.number({ message: 'Informe a empresa.' }).int('Empresa inválida.'),
  vrcusto: dec(z.number().nonnegative('Custo inválido')),
  vrcustorep: dec(z.number().nonnegative('Custo rep. inválido')),
  markup: dec(),
  vrvenda: dec(z.number().nonnegative('Preço de venda inválido')),
  vrpromo: dec(z.number().nonnegative('Preço promocional inválido')),
  promocao: sn().default('N'),
  margeml: dec(),
  aliquotasaida: z.string().trim().max(3).optional(), // código fiscal de saída (→ det_aliquota)
  ativo: sn().default('S'),
  ativo_compra: sn().default('S'),
});
export type PrecoProdutoDto = z.infer<typeof precoProdutoSchema>;

/**
 * Estoque POR EMPRESA (detalhe 1:N — ESTOQUE). Na MESMA form do produto (aba Estoque).
 * REGRA: o SALDO (`qtde`) é MOVIDO POR TRANSAÇÃO (NF/vendas/ajuste) — no cadastro é
 * READ-ONLY; só MINIMO/MAXIMO/LOCAL são editáveis. `qtde` ronda no payload (read-only) só
 * para preservar o saldo no substitute do agregado; nunca é alterado pelo usuário aqui.
 */
export const estoqueProdutoSchema = z.object({
  idempresa: z.number({ message: 'Informe a empresa.' }).int('Empresa inválida.'),
  qtde: dec(z.number().nonnegative('Saldo inválido')), // saldo (read-only no cadastro)
  minimo: dec(z.number().nonnegative('Mínimo inválido')),
  maximo: dec(z.number().nonnegative('Máximo inválido')),
  local: z.string().trim().max(50).optional(),
});
export type EstoqueProdutoDto = z.infer<typeof estoqueProdutoSchema>;

/** Item de COMPOSIÇÃO (kit): idproduto_01 = componente (outro produto, lookup). */
export const composicaoItemSchema = z.object({
  idproduto_01: z.number().int().optional(), // componente (→ produtos)
  qtde: dec(z.number().nonnegative('Quantidade inválida')),
  valor: dec(z.number().nonnegative('Valor inválido')), // custo unitário do componente
  descricao: z.string().trim().max(100).optional(),
});
export type ComposicaoItemDto = z.infer<typeof composicaoItemSchema>;

/** Item de DECOMPOSIÇÃO (1 produto → vários): idproduto_01 = resultante; percentual da partida. */
export const decomposicaoItemSchema = z.object({
  idproduto_01: z.number().int().optional(),
  percentual: dec(z.number().nonnegative('Percentual inválido')),
});
export type DecomposicaoItemDto = z.infer<typeof decomposicaoItemSchema>;

/** Item de RECEITA (ficha técnica): idproduto_receita = ingrediente. */
export const receitaItemSchema = z.object({
  idproduto_receita: z.number().int().optional(),
  qtde: dec(z.number().nonnegative('Quantidade inválida')),
  valor: dec(z.number().nonnegative('Valor inválido')),
  unidade: z.string().trim().max(2).optional(),
  servico: sn().optional(),
  fatorcxprod: dec(z.number().nonnegative('Fator inválido')),
});
export type ReceitaItemDto = z.infer<typeof receitaItemSchema>;

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
  mva: dec(z.number().nonnegative('MVA inválido')),
  origemprod: opcional(z.enum(ORIGEM_VALUES, { message: 'Origem inválida.' })),
  // unidade/balança/validade
  balanca: sn().default('N'),
  codbalanca: z.number().int().optional(),
  fatorkg: dec(z.number().nonnegative('Fator KG inválido')),
  peso: dec(z.number().nonnegative('Peso inválido')),
  fatorcx: z.number().int().optional(),
  validade: z.number().int().optional(),
  controle_validade: sn().default('S'),
  // controle / auto-relacionamento
  ativo: sn().default('S'),
  ativo_compra: sn().default('S'),
  geraqtde: sn().optional(), // F3 (NF): controla se o produto movimenta estoque (default 'S' no banco)
  idproduto_pai: z.number().int().optional(),
  fator_filho: dec(z.number().nonnegative('Fator do filho inválido')),
  // F4 — flags de kit/BOM (derivadas server-side da presença de itens; round-trip)
  composicao: sn().optional(),
  decomposicao: sn().optional(),
  receita: sn().optional(),
  // F4b — NUTRICIONAL (rotulagem; armazenamento puro, VD% digitados)
  valorenergetico: dec(z.number().nonnegative()),
  carboidrato: dec(z.number().nonnegative()),
  proteina: dec(z.number().nonnegative()),
  gorduratotal: dec(z.number().nonnegative()),
  gordurasaturada: dec(z.number().nonnegative()),
  gorduratrans: dec(z.number().nonnegative()),
  fibra: dec(z.number().nonnegative()),
  sodio: dec(z.number().nonnegative()),
  acucares_totais: dec(z.number().nonnegative()),
  acucares_adicionados: dec(z.number().nonnegative()),
  vd_valorenergetico: dec(z.number().nonnegative()),
  vd_carboidrato: dec(z.number().nonnegative()),
  vd_proteina: dec(z.number().nonnegative()),
  vd_gorduratotal: dec(z.number().nonnegative()),
  vd_gordurasaturada: dec(z.number().nonnegative()),
  vd_gorduratrans: dec(z.number().nonnegative()),
  vd_fibra: dec(z.number().nonnegative()),
  vd_sodio: dec(z.number().nonnegative()),
  unporcao: z.number().int().optional(),
  qtde_porcao: dec(z.number().nonnegative()),
  desc_porcao: z.string().trim().max(35).optional(),
  acucar_adcionado: sn().optional(),
  gordura_saturada: sn().optional(),
  altoem_sodio: sn().optional(),
  expdadosnutricionais: sn().optional(),
  codinfanutri: z.number().int().optional(),
  // F4b — LOGÍSTICA (dimensões produto/caixa/pallet + paletização)
  comprimento_produto: dec(z.number().nonnegative()),
  comprimento_caixa: dec(z.number().nonnegative()),
  comprimento_pallet: dec(z.number().nonnegative()),
  largura_produto: dec(z.number().nonnegative()),
  largura_caixa: dec(z.number().nonnegative()),
  largura_pallet: dec(z.number().nonnegative()),
  altura_produto: dec(z.number().nonnegative()),
  altura_caixa: dec(z.number().nonnegative()),
  altura_pallet: dec(z.number().nonnegative()),
  pesoliq_produto: dec(z.number().nonnegative()),
  pesoliq_caixa: dec(z.number().nonnegative()),
  pesoliq_pallet: dec(z.number().nonnegative()),
  pesobruto_produto: dec(z.number().nonnegative()),
  pesobruto_caixa: dec(z.number().nonnegative()),
  pesobruto_pallet: dec(z.number().nonnegative()),
  pallet_caixas_por_camada: z.number().int().optional(),
  pallet_camadas_por_pallet: z.number().int().optional(),
  pallet_caixas_por_pallet: z.number().int().optional(),
  pallet_empilhamento: z.number().int().optional(),
  pallet_produtos_por_caixa: z.number().int().optional(),
  pallet_produtos_por_pallet: z.number().int().optional(),
  fatorcx_prod: dec(z.number().nonnegative()),
  // detalhes 1:N (engine de agregado grava todos numa transação)
  codauxiliares: z.array(codAuxiliarSchema).optional().default([]),
  precos: z.array(precoProdutoSchema).optional().default([]), // F2 — MULTI_PRECO por empresa (mesma form)
  estoques: z.array(estoqueProdutoSchema).optional().default([]), // F3 — ESTOQUE por empresa (saldo read-only)
  // F4 — kit/BOM (3 sub-grids na mesma form; cada item referencia outro produto)
  composicoes: z.array(composicaoItemSchema).optional().default([]),
  decomposicoes: z.array(decomposicaoItemSchema).optional().default([]),
  receitas: z.array(receitaItemSchema).optional().default([]),
});

/**
 * A API devolve colunas vazias como `null` (e numeric como string). Ao REABRIR o registro
 * p/ edição e reenviar, `z.optional()` reprovaria `null` (só aceita `undefined`). Este
 * preprocess torna o schema IDEMPOTENTE com a própria saída: remove `null` (→ ausente),
 * recursivo em arrays/objetos (cobre os detalhes precos/codauxiliares). A coerção de
 * numeric-string fica no `dec()` por campo.
 */
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

/** Regra do legado (btnGravar): a DECOMPOSIÇÃO deve somar 100% (só quando há itens; 2 casas). */
const validaDecomposicao100 = (
  d: { decomposicoes?: { percentual?: number }[] },
  ctx: z.RefinementCtx,
) => {
  const dec = d.decomposicoes ?? [];
  if (dec.length > 0) {
    const total = dec.reduce((s, it) => s + (Number(it.percentual) || 0), 0);
    if (total.toFixed(2) !== (100).toFixed(2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A decomposição não atingiu 100% da partida, verifique',
        path: ['decomposicoes'],
      });
    }
  }
};

/** Regra do legado (btnGravarClick): CEST é obrigatório quando a alíquota é do tipo 'STB' (ST). */
export const produtoSchema = z.preprocess(stripNulls, produtoBase).superRefine((d, ctx) => {
  if (d.aliquota === 'STB' && !(d.cest && d.cest.trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Para alíquota do tipo "STB", a informação do CEST é obrigatória.',
      path: ['cest'],
    });
  }
  validaDecomposicao100(d, ctx);
});
export type CriarProdutoDto = z.infer<typeof produtoSchema>;

export const atualizarProdutoSchema = z
  .preprocess(stripNulls, produtoBase.partial())
  .superRefine((d, ctx) => validaDecomposicao100(d as { decomposicoes?: { percentual?: number }[] }, ctx));
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
