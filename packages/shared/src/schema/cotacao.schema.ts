import { z } from 'zod';

/**
 * COTAÇÃO DE COMPRA (FRMCADCOTACAO — uCadCotacao) — corte-1: estrutura + preços. Árvore: COTACAO → produtos
 * (+ qtde por loja) + fornecedores convidados → matriz de preço (fornecedor×produto). O comprador cria a cotação
 * e lança os preços de cada fornecedor; a apuração (vencedor = menor preço líq-ICMS) + gerar-pedido são o corte-2.
 * Estado 'A' (Aberta, editável) / 'F' (Fechada). Mensagens PT (ADR-015). empresaScoped (empresa dona).
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

/** qtde de um produto por LOJA (multi-empresa; gerar-pedido re-explode — corte-2). */
export const cotacaoProdQtdeSchema = z.object({
  idempresa: z.coerce.number().int().positive(),
  qtde: z.coerce.number().min(0),
});

/** produto a cotar (o comprador escolhe; custo/venda são referência/snapshot). */
export const cotacaoProdSchema = z.object({
  idproduto: z.coerce.number().int().positive({ message: 'Informe o produto.' }),
  descricao: opcional(z.string().max(120)),
  quantidade: dec(z.number().min(0)),
  fatorembalagem: dec(z.number().min(0)),
  valorcusto: dec(z.number()),
  valorvenda: dec(z.number()),
  qtdes: z.array(cotacaoProdQtdeSchema).max(200).optional(), // por loja (opcional)
});

/** fornecedor convidado a cotar. */
export const cotacaoFornSchema = z.object({
  codparceiro: z.coerce.number().int().positive({ message: 'Informe o fornecedor.' }),
  participa_apuracao: opcional(z.enum(['S', 'N'])),
  datavalidade: opcional(z.string()),
  obs: opcional(z.string().max(255)),
});

const cotacaoBaseSchema = z.object({
  descricao: opcional(z.string().max(120)),
  flg_origem: opcional(z.enum(['C', 'L'])),
  dtinicio_preenchimento: opcional(z.string()),
  dtfim_preenchimento: opcional(z.string()),
  produtos: z.array(cotacaoProdSchema).min(1, 'Inclua ao menos um produto na cotação.').max(5000),
  fornecedores: z.array(cotacaoFornSchema).min(1, 'Convide ao menos um fornecedor.').max(500),
});
// janela de preenchimento: fim > início (fiel uCadCotacao.pas:711-716).
const janelaValida = (v: { dtinicio_preenchimento?: string; dtfim_preenchimento?: string }, ctx: z.RefinementCtx) => {
  if (v.dtinicio_preenchimento && v.dtfim_preenchimento && v.dtfim_preenchimento <= v.dtinicio_preenchimento) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dtfim_preenchimento'], message: 'A data fim do preenchimento deve ser posterior à data início.' });
  }
};
export const criarCotacaoSchema = cotacaoBaseSchema.superRefine(janelaValida);
export type CriarCotacaoDto = z.infer<typeof criarCotacaoSchema>;

export const atualizarCotacaoSchema = cotacaoBaseSchema.partial().superRefine(janelaValida);
export type AtualizarCotacaoDto = z.infer<typeof atualizarCotacaoSchema>;

/** preço cotado de um produto por um fornecedor (a célula da matriz). */
export const cotacaoPrecoItemSchema = z.object({
  idproduto: z.coerce.number().int().positive(),
  valor: z.coerce.number().min(0),
  valorembal: dec(z.number().min(0)),
  fatorembalagem: dec(z.number().min(0)),
  icms: dec(z.number().min(0)),
});

/** lançar/atualizar os preços de UM fornecedor (upsert na matriz). */
export const lancarPrecosCotacaoSchema = z.object({
  codparceiro: z.coerce.number().int().positive({ message: 'Informe o fornecedor.' }),
  itens: z.array(cotacaoPrecoItemSchema).min(1).max(5000),
});
export type LancarPrecosCotacaoDto = z.infer<typeof lancarPrecosCotacaoSchema>;

/** define manualmente o vencedor de um produto (corte-2, F5). */
export const definirGanhadorCotacaoSchema = z.object({
  idproduto: z.coerce.number().int().positive(),
  codparceiro: z.coerce.number().int().positive(),
});
export type DefinirGanhadorCotacaoDto = z.infer<typeof definirGanhadorCotacaoSchema>;

export const COTACAO_SITUACAO = ['A', 'F'] as const;
export type CotacaoSituacao = (typeof COTACAO_SITUACAO)[number];
