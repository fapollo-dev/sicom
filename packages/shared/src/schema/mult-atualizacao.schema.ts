import { z } from 'zod';

/**
 * ATUALIZAÇÃO AUTOMÁTICA DE PRODUTOS (`FRMMULTATUALIZACAO`, `uMultAtualizacao.pas`).
 *
 * Escolhe produtos, escolhe UM campo, escolhe uma operação, e aplica em todos de uma vez.
 */

/**
 * As sete operações do legado (`TTipoOperacaoAlteracao`, aplicadas em `EditaDataset` :619-770).
 * As três de texto e as quatro de número — o que vale depende do tipo do campo.
 */
export const OPERACOES_MULT = [
  { value: 'SUBSTITUIR', label: 'Substituir', tipo: 'ambos' },
  { value: 'PREFIXAR', label: 'Somar no início (texto)', tipo: 'texto' },
  { value: 'SUFIXAR', label: 'Somar no fim (texto)', tipo: 'texto' },
  { value: 'SOMAR', label: 'Somar', tipo: 'numero' },
  { value: 'SUBTRAIR', label: 'Subtrair', tipo: 'numero' },
  { value: 'MULTIPLICAR', label: 'Multiplicar', tipo: 'numero' },
  { value: 'DIVIDIR', label: 'Dividir', tipo: 'numero' },
] as const;

export type OperacaoMult = (typeof OPERACOES_MULT)[number]['value'];

/**
 * Os campos que o combo do legado oferece — a grade tem 50 colunas e o `FormShow` (:990-1016) tira 20 delas
 * por substring (`PIS`, `FRETE`, `ICME`, `ICMST`, `IPI`, `SEGURO`, `PROMOCAO`, `ESTOQUE_*`, `VR_CUSTOREAL`,
 * `VR_PROMO`, `NATUREZA`, `DESPACESSORIO`, `DESCFIGURAFISCAL`, `FORNECEDOR`, `LUCROLIQP`, `EMPRESA`) mais
 * `GRUPO`, `DEPTO` e `SUBGRUPO` exatos (que são os campos de DESCRIÇÃO; o código correspondente fica).
 *
 * ⚠️ **divergência consciente**: a lista de exclusão do legado esqueceu os campos de CONTROLE — `IDPRODUTO`,
 * `CAMPO`, `OPERACAO`, `DTULTIMALTERACAO`, `USULTALTERACAO` e `CODOPERADOR` continuam no combo, e alterar
 * `IDPRODUTO` em massa não tem leitura nenhuma. Aqui eles ficam de fora: são identidade e auditoria, não
 * cadastro. `CODAUXILIAR` também sai, porque nem existe em `PRODUTOS` no Oracle.
 *
 * `onde` diz em que tabela o campo é gravado: `multi_preco` é POR EMPRESA (é lá que preço e markup vivem),
 * `ambos` são os dois flags que o legado grava nos dois lugares.
 */
export const CAMPOS_MULT = [
  { campo: 'DESCRICAO', coluna: 'descricao', tipo: 'texto', onde: 'produtos', label: 'Descrição' },
  { campo: 'CODBARRA', coluna: 'codbarra', tipo: 'texto', onde: 'produtos', label: 'Código de barras' },
  { campo: 'CEST', coluna: 'cest', tipo: 'texto', onde: 'produtos', label: 'CEST' },
  { campo: 'NCMSH', coluna: 'ncmsh', tipo: 'texto', onde: 'produtos', label: 'NCM' },
  { campo: 'UNIDADE', coluna: 'unidade', tipo: 'texto', onde: 'produtos', label: 'Unidade' },
  { campo: 'ALIQUOTA', coluna: 'aliquota', tipo: 'texto', onde: 'produtos', label: 'Alíquota' },
  { campo: 'BALANCA', coluna: 'balanca', tipo: 'texto', onde: 'produtos', label: 'Balança' },
  { campo: 'COMPOSICAO', coluna: 'composicao', tipo: 'texto', onde: 'produtos', label: 'Composição' },
  { campo: 'ESPECIFICACAO', coluna: 'especificacao', tipo: 'texto', onde: 'produtos', label: 'Especificação' },
  { campo: 'TIPOPIS', coluna: 'tipopis', tipo: 'texto', onde: 'produtos', label: 'Tipo PIS' },
  { campo: 'ATIVO', coluna: 'ativo', tipo: 'texto', onde: 'ambos', label: 'Ativo' },
  { campo: 'ATIVO_COMPRA', coluna: 'ativo_compra', tipo: 'texto', onde: 'ambos', label: 'Ativo para compra' },
  { campo: 'CODGRUPO', coluna: 'codgrupo', tipo: 'numero', onde: 'produtos', label: 'Código do grupo' },
  { campo: 'CODSUBGRUPO', coluna: 'codsubgrupo', tipo: 'numero', onde: 'produtos', label: 'Código do subgrupo' },
  { campo: 'CODDPTO', coluna: 'coddpto', tipo: 'numero', onde: 'produtos', label: 'Código do departamento' },
  { campo: 'CODSECAO', coluna: 'codsecao', tipo: 'numero', onde: 'produtos', label: 'Código da seção' },
  { campo: 'CODFOR', coluna: 'codfor', tipo: 'numero', onde: 'produtos', label: 'Código do fornecedor' },
  { campo: 'CODBALANCA', coluna: 'codbalanca', tipo: 'numero', onde: 'produtos', label: 'Código na balança' },
  { campo: 'CODFIGURAFISCAL', coluna: 'codfigurafiscal', tipo: 'numero', onde: 'produtos', label: 'Figura fiscal' },
  { campo: 'CODGRUPOPRECO', coluna: 'codgrupopreco', tipo: 'numero', onde: 'produtos', label: 'Grupo de preço' },
  { campo: 'FATORKG', coluna: 'fatorkg', tipo: 'numero', onde: 'produtos', label: 'Fator KG' },
  { campo: 'FATORCX', coluna: 'fatorcx', tipo: 'numero', onde: 'produtos', label: 'Fator CX' },
  { campo: 'VALIDADE', coluna: 'validade', tipo: 'numero', onde: 'produtos', label: 'Validade (dias)' },
  { campo: 'COMISSAO', coluna: 'comissao', tipo: 'numero', onde: 'produtos', label: 'Comissão' },
  { campo: 'DESCMAX', coluna: 'descmax', tipo: 'numero', onde: 'produtos', label: 'Desconto máximo' },
  { campo: 'COMPQTDE', coluna: 'compqtde', tipo: 'numero', onde: 'produtos', label: 'Qtde da composição' },
  { campo: 'COMPFATOR', coluna: 'compfator', tipo: 'numero', onde: 'produtos', label: 'Fator da composição' },
  { campo: 'VR_CUSTO', coluna: 'vrcusto', tipo: 'numero', onde: 'multi_preco', label: 'Valor de custo' },
  { campo: 'VR_VENDA', coluna: 'vrvenda', tipo: 'numero', onde: 'multi_preco', label: 'Valor de venda' },
  { campo: 'VRCUSTOREP', coluna: 'vrcustorep', tipo: 'numero', onde: 'multi_preco', label: 'Custo de reposição' },
  { campo: 'MARKUP', coluna: 'markup', tipo: 'numero', onde: 'multi_preco', label: 'Markup' },
  { campo: 'MARKUPFIXO', coluna: 'markupfixo', tipo: 'numero', onde: 'multi_preco', label: 'Markup fixo' },
] as const;

export type CampoMult = (typeof CAMPOS_MULT)[number]['campo'];
const CAMPOS = CAMPOS_MULT.map((c) => c.campo) as [CampoMult, ...CampoMult[]];

/** `Valor` (0) ou `Percentual` (1) do `cbbValor_Porcento` — o percentual é do valor ATUAL de cada produto. */
export const MODOS_VALOR = ['VALOR', 'PERCENTUAL'] as const;

export const filtroProdutosMultSchema = z.object({
  texto: z.string().trim().max(120).optional(),
  codgrupo: z.coerce.number().int().positive().optional(),
  codsubgrupo: z.coerce.number().int().positive().optional(),
  coddpto: z.coerce.number().int().positive().optional(),
  codfor: z.coerce.number().int().positive().optional(),
  somenteAtivos: z.enum(['S', 'N', 'T']).default('S'),
  limite: z.coerce.number().int().positive().max(5000).default(500),
});

export const simularMultSchema = z.object({
  idprodutos: z.array(z.coerce.number().int().positive()).min(1).max(5000),
  campo: z.enum(CAMPOS),
  operacao: z.enum(OPERACOES_MULT.map((o) => o.value) as [OperacaoMult, ...OperacaoMult[]]),
  modo: z.enum(MODOS_VALOR).default('VALOR'),
  /**
   * ⚠️ **sem `trim`, de propósito**: `PREFIXAR` com `'ORG '` precisa do espaço, senão `ARROZ` vira
   * `ORGARROZ`. O legado não apara o valor (`:671` só troca ponto por vírgula) e nós também não.
   */
  valor: z.string().min(1).max(300),
})
  // ⚠️ `toaDividir` no legado é `valor / ValorOperacao` sem nenhuma proteção: dividir por zero derruba a
  // alteração inteira no meio, com parte dos produtos já mexida em memória. Aqui é recusado na porta.
  .refine((s) => !(s.operacao === 'DIVIDIR' && Number(s.valor.replace(',', '.')) === 0), {
    message: 'não dá para dividir por zero', path: ['valor'],
  })
  .refine((s) => {
    const meta = CAMPOS_MULT.find((c) => c.campo === s.campo)!;
    const op = OPERACOES_MULT.find((o) => o.value === s.operacao)!;
    return op.tipo === 'ambos' || op.tipo === meta.tipo;
  }, { message: 'a operação não serve para este tipo de campo', path: ['operacao'] })
  .refine((s) => {
    const meta = CAMPOS_MULT.find((c) => c.campo === s.campo)!;
    if (meta.tipo !== 'numero') return true;
    return Number.isFinite(Number(s.valor.replace(',', '.')));
  }, { message: 'informe um número', path: ['valor'] });

export const aplicarMultSchema = simularMultSchema;

/** a aba PIS/COFINS (`BtnAlterarPCClick` :141-227): três campos e as travas fiscais próprias. */
export const pisCofinsMultSchema = z.object({
  idprodutos: z.array(z.coerce.number().int().positive()).min(1).max(5000),
  idpiscofins: z.coerce.number().int().nonnegative().optional(),
  /** `N` não-cumulativo · `A` cumulativo · `I` isento retido · `S` suspenso · `Z` alíquota zero. */
  tipopis: z.enum(['N', 'A', 'I', 'S', 'Z']).optional(),
  natureza: z.coerce.number().int().nonnegative().optional(),
}).refine((p) => !!p.idpiscofins || !!p.tipopis || !!p.natureza, {
  message: 'informe os dados para realizar a alteração', path: ['idpiscofins'],
});

export type FiltroProdutosMultDto = z.infer<typeof filtroProdutosMultSchema>;
export type SimularMultDto = z.infer<typeof simularMultSchema>;
export type PisCofinsMultDto = z.infer<typeof pisCofinsMultSchema>;
