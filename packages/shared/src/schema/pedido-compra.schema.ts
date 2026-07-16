import { z } from 'zod';

/**
 * PEDIDO DE COMPRA (FRMPEDIDOCOMPRA) — a MAIOR tela do legado. Corte-1: NÚCLEO cadastro,
 * agregado mestre-detalhe (cabeçalho PEDIDOCOMPRA + itens PEDIDOCOMPRA_I). É o documento de
 * INTENÇÃO de compra (previsão); o FATO (fiscal/estoque/financeiro) nasce na NF de entrada.
 *
 * Achados do recon Oracle refletidos aqui (078 FLIP):
 *  - QTDE = nº de embalagens pedidas (PEDIDO_COMPRA_QTDE.QTDE, uPedidoCompra.pas:1971-1972); FATOREMBALAGEM = fator (FATORCX).
 *  - Derivados server-side: VLREMBALAGEM = FATOREMBALAGEM×VRCUSTO (custo/caixa); QTDTOTAL = QTDE×FATOREMBALAGEM (unidades);
 *    TOTALCUSTO = QTDE×VLREMBALAGEM (total da linha). Total do pedido = Σ TOTALCUSTO (era Σ VLREMBALAGEM, subcontava ~2,5×).
 *  - Fornecedor (CODPARCEIRO) obrigatório; ao menos 1 item.
 *  - Impostos/markup/preço-venda do item = simulação/analítica → ADIADO (imposto definitivo é da NF).
 * Mensagens em PT (ADR-015). O pedido é empresaScoped (IDEMPRESA carimbado pelo engine).
 */

/* ── helpers (idem nf.schema) ── */
const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

/** decimal tolerante: aceita número OU string numérica ('' / null → ausente). numeric do PG volta string. */
const dec = (inner: z.ZodNumber = z.number()) =>
  z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  }, inner.optional());

/* ── combos ── */
export const PC_TIPO_FRETE = ['CIF', 'FOB'] as const;
export const PC_TIPO_FRETE_OPCOES = [
  { value: 'CIF', label: 'CIF (por conta do fornecedor)' },
  { value: 'FOB', label: 'FOB (por conta do comprador)' },
] as const;

/* ── item ── */
/** Item do pedido: produto + QTDE (nº de embalagens) + FATOREMBALAGEM (fator) + custo. Derivados server-side:
 *  VLREMBALAGEM=fator×custo (custo/caixa), QTDTOTAL=qtde×fator (unidades), TOTALCUSTO=qtde×vlrembalagem (linha). */
export const pedidoCompraItemSchema = z.object({
  idproduto: z.coerce.number({ message: 'Produto inválido.' }).int().positive('Informe o produto do item.'),
  // QTDE = nº de embalagens pedidas (078 FLIP; o comprador digita CAIXAS). > 0; default 1. Base do TOTALCUSTO.
  qtde: z.coerce
    .number({ message: 'Quantidade inválida.' })
    .positive('A quantidade deve ser maior que zero.')
    .max(9_999_999, 'Quantidade acima do limite permitido.')
    .optional()
    .default(1),
  // FATOREMBALAGEM = fator de embalagem (FATORCX, unidades/caixa). > 0. Teto coerente com a coluna numeric(13,2).
  fatorembalagem: z.coerce
    .number({ message: 'Fator de embalagem inválido.' })
    .positive('O fator de embalagem deve ser maior que zero.')
    .max(9_999_999, 'Fator de embalagem acima do limite permitido.'),
  // custo unitário negociado com o fornecedor (âncora do item). Teto coerente com numeric(12,4).
  vrcusto: z.coerce
    .number({ message: 'Custo inválido.' })
    .nonnegative('Custo inválido.')
    .max(9_999_999, 'Custo acima do limite permitido.'),
  // derivados server-authoritative (aceitos no payload p/ round-trip): custo/caixa, unidades totais, total da linha.
  vlrembalagem: dec(z.number().nonnegative()),
  qtdtotal: dec(z.number().nonnegative()),
  totalcusto: dec(z.number().nonnegative()),
  desconto: dec(z.number().nonnegative('Desconto inválido.')),
  descontop: dec(z.number().nonnegative('Desconto (%) inválido.').max(100, 'Desconto (%) inválido.')),
  obs: opcional(z.string().trim().max(1000)),
  // precificação do item (reuso do motor /precificacao/produto; o comprador forma o preço). Analítica
  // armazenada no item — SEM propagação ao catálogo (MULTI_PRECO fica p/ corte próprio). Nomes fiéis ao
  // legado: vrvenda (PRATICADO) ≠ vrvendasug (SUGERIDO pelo motor); margeml2 (%) + margeml2v (valor R$).
  vrcustoliquido: dec(z.number().nonnegative()),
  markup: dec(z.number()),
  vrvenda: dec(z.number().nonnegative()),
  vrvendasug: dec(z.number().nonnegative()),
  margeml2: dec(z.number()),
  margeml2v: dec(z.number()),
  pmz: dec(z.number().nonnegative()),
  // % bonificado do item (100 no pedido-espelho de bonificação).
  bonificacao: dec(z.number().nonnegative().max(100, 'Bonificação (%) inválida.')),
});
export type PedidoCompraItemDto = z.infer<typeof pedidoCompraItemSchema>;

/* ── parcela (corte-2) ── */
/** Parcela do pedido: número + vencimento + valor + dias-após-faturamento. Gerada por `gerar-parcelas`
 *  (RatearTotalNasParcelas) mas EDITÁVEL (o legado permite ajustar valores/datas). idempresa = server. */
export const pedidoCompraParcelaSchema = z.object({
  parcela: z.coerce.number({ message: 'Parcela inválida.' }).int().positive(),
  data: opcional(z.string().trim()),
  valor: dec(z.number().nonnegative('Valor da parcela inválido.')),
  qtdediasaposfaturamento: opcional(z.coerce.number().int().nonnegative()),
});
export type PedidoCompraParcelaDto = z.infer<typeof pedidoCompraParcelaSchema>;

/* ── cabeçalho ── */
const pedidoCompraBase = z.object({
  // CODOPERADOR (comprador) e FECHADO (workflow) NÃO entram no payload — são server-controlled.
  codparceiro: z.coerce
    .number({ message: 'Favor informar o fornecedor.' })
    .int('Favor informar o fornecedor.')
    .positive('Favor informar o fornecedor.'),
  data: z.string({ message: 'Informe a data do pedido.' }).trim().min(1, 'Informe a data do pedido.'),
  dt_vencimento: opcional(z.string().trim()),
  codconpagto: opcional(z.coerce.number().int()),
  // corte-2: data-base do vencimento das parcelas (legado DTFATURAMENTO input; separada do marcador "recebido").
  data_faturamento: opcional(z.string().trim()),
  // corte-final: situação-NF do pedido (classificação; o gerar-NF a carrega para a NF de entrada).
  idsituacao_nf: opcional(z.coerce.number().int()),
  // corte-2: CD1..CD8 = OVERRIDE local dos prazos (dias) da condição; nº de parcelas = qtd de CDn não-nulos.
  cd1: opcional(z.coerce.number().int().nonnegative()),
  cd2: opcional(z.coerce.number().int().nonnegative()),
  cd3: opcional(z.coerce.number().int().nonnegative()),
  cd4: opcional(z.coerce.number().int().nonnegative()),
  cd5: opcional(z.coerce.number().int().nonnegative()),
  cd6: opcional(z.coerce.number().int().nonnegative()),
  cd7: opcional(z.coerce.number().int().nonnegative()),
  cd8: opcional(z.coerce.number().int().nonnegative()),
  pc_tipo_frete: opcional(z.enum(PC_TIPO_FRETE)),
  pc_valor_frete: dec(z.number().nonnegative('Valor de frete inválido.')),
  pc_nronf_cruzamento: opcional(z.string().trim().max(500)),
  obs: opcional(z.string().trim().max(2000)),
  itens: z.array(pedidoCompraItemSchema).optional().default([]),
  // corte-2: parcelas (2º detalhe). Editáveis; se ausentes num PUT, NÃO são tocadas (chave ausente).
  parcelas: z.array(pedidoCompraParcelaSchema).optional(),
});

/** ValidaDatas do legado (uPedidoCompra.pas:8216/8232): faturamento e vencimento não podem ANTECEDER a data. */
const validaDatasPedido = (d: { data?: string; data_faturamento?: string; dt_vencimento?: string }, ctx: z.RefinementCtx) => {
  const t = (s?: string) => (s && s.trim() ? new Date(s).getTime() : NaN);
  const dt = t(d.data);
  if (!Number.isNaN(dt) && !Number.isNaN(t(d.data_faturamento)) && t(d.data_faturamento) < dt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data_faturamento'], message: 'A data de faturamento não pode ser anterior à data do pedido.' });
  }
  if (!Number.isNaN(dt) && !Number.isNaN(t(d.dt_vencimento)) && t(d.dt_vencimento) < dt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dt_vencimento'], message: 'O vencimento não pode ser anterior à data do pedido.' });
  }
};

/** CREATE — exige ao menos 1 item (btnGravar do legado). */
export const pedidoCompraSchema = pedidoCompraBase
  .extend({
    itens: z.array(pedidoCompraItemSchema).min(1, 'Informe ao menos um item no pedido.'),
  })
  .superRefine(validaDatasPedido);
export type CriarPedidoCompraDto = z.infer<typeof pedidoCompraSchema>;

/** UPDATE — parcial (o header pode vir só com os campos alterados; itens, se vierem, substituem). */
export const atualizarPedidoCompraSchema = pedidoCompraBase.partial().superRefine(validaDatasPedido);
export type AtualizarPedidoCompraDto = z.infer<typeof atualizarPedidoCompraSchema>;

/**
 * RECEBIMENTO — opções para gerar a NF de entrada a partir do pedido (todos opcionais; defaults no serviço:
 * modelo=1, série='1', CFOP='1102'). São os campos que o pedido não fornece (o real vem da NF do fornecedor).
 */
export const gerarNfPedidoSchema = z.object({
  modelo: opcional(z.coerce.number().int().positive()),
  serie: opcional(z.string().trim().max(3)),
  cfop: opcional(z.string().trim().max(4)),
  // RECEBIMENTO PARCIAL 1:N (Wave 4): quantidades explícitas a receber por produto (≤ saldo). Omitido → recebe
  // o SALDO restante de todos os produtos. Cada item ≤ saldo do produto (senão RECEBIMENTO_EXCEDE_SALDO).
  quantidades: opcional(
    z.array(z.object({ idproduto: z.coerce.number().int().positive(), quantidade: z.coerce.number().positive() })).max(990),
  ),
});
export type GerarNfPedidoDto = z.infer<typeof gerarNfPedidoSchema>;

/** corte-final — importar itens em massa do fornecedor (ImportaItens): associados (CODFOR) ou já comprados. */
export const importarItensPedidoSchema = z.object({
  origem: z.enum(['associados', 'comprados'], { message: "Origem inválida (use 'associados' ou 'comprados')." }),
});
export type ImportarItensPedidoDto = z.infer<typeof importarItensPedidoSchema>;

/**
 * RECEBIMENTO corte-2 — importar o XML da NFe do fornecedor → NF de entrada valorada. `xml` = conteúdo do
 * arquivo (colado ou lido no cliente). `codpedcomp` opcional vincula ao pedido (guardas do corte-1).
 */
export const importarXmlNfeSchema = z.object({
  xml: z.string({ message: 'Informe o XML da NFe.' }).trim().min(1, 'Informe o XML da NFe.'),
  codpedcomp: opcional(z.coerce.number().int().positive()),
});
export type ImportarXmlNfeDto = z.infer<typeof importarXmlNfeSchema>;

/**
 * RECEBIMENTO corte-3 — vincular produto do fornecedor (de-para CODREFERENCIA_FOR). Resolve as pendências do
 * import: o operador escolhe o `idproduto` p/ cada item não-casado; grava a de-para (por fornecedor `codfor`)
 * — para cada vínculo, um registro 'E' (cEAN) e um 'P' (cProd), quando presentes (espelha o legado). Depois
 * reimporta e o match casa sozinho. Ao menos cEAN OU cProd por vínculo.
 */
export const vincularProdutosSchema = z.object({
  codfor: z.coerce.number({ message: 'Fornecedor inválido.' }).int().positive('Fornecedor inválido.'),
  vinculos: z
    .array(
      z
        .object({
          idproduto: z.coerce.number({ message: 'Produto inválido.' }).int().positive('Informe o produto.'),
          cEAN: opcional(z.string().trim().max(60)),
          cProd: opcional(z.string().trim().max(60)),
          fator: dec(z.number().positive()),
        })
        .superRefine((v, ctx) => {
          const ean = v.cEAN && v.cEAN.toUpperCase() !== 'SEM GTIN' ? v.cEAN : '';
          if (!ean && !v.cProd) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cEAN'], message: 'Informe o EAN ou o código do fornecedor.' });
        }),
    )
    .min(1, 'Informe ao menos um vínculo.')
    .max(990, 'Vínculos demais (limite de 990).'), // teto anti-DoS (paridade com o cap de itens do import)
});
export type VincularProdutosDto = z.infer<typeof vincularProdutosSchema>;

/* ── registros devolvidos (lista / agregado) ── */
export interface PedidoCompra {
  codpedcomp: number;
  codigo?: number;
  idempresa?: number;
  data?: string;
  codparceiro: number;
  fornecedor?: string | null;
  codoperador?: number | null;
  dt_vencimento?: string | null;
  codconpagto?: number | null;
  data_faturamento?: string | null;
  cd1?: number | null;
  cd2?: number | null;
  cd3?: number | null;
  cd4?: number | null;
  cd5?: number | null;
  cd6?: number | null;
  cd7?: number | null;
  cd8?: number | null;
  pc_tipo_frete?: string | null;
  pc_valor_frete?: number | string | null;
  pc_nronf_cruzamento?: string | null;
  fechado?: string | null; // 'S' = fechado
  bonificacao?: string | null; // 'S' = pedido-espelho de bonificação
  idsituacao_nf?: number | null;
  operador_ult_lib_valor_max?: number | null; // liberador do limite de compra
  dtfaturamento?: string | null;
  dtencerramento?: string | null;
  obs?: string | null;
  indr?: string | null;
  total?: number | string | null; // Σ TOTALCUSTO (view; 078 FLIP)
  qtde_itens?: number | string | null;
  itens?: PedidoCompraItem[];
  parcelas?: PedidoCompraParcela[];
}

export interface PedidoCompraParcela {
  codpedcompparcelas?: number;
  codpedcomp?: number;
  idempresa?: number | null;
  parcela: number;
  data?: string | null;
  valor?: number | string | null;
  qtdediasaposfaturamento?: number | null;
}

export interface PedidoCompraItem {
  codpedcompi?: number;
  codpedcomp?: number;
  idproduto: number;
  // 078 FLIP: QTDE (nº de embalagens) + derivados. EXPOSTOS no read-type (fold auditoria): um consumidor
  // tipado que remonta o item no PUT precisa VER qtde — senão o omite → default(1) → reintroduz o undercount.
  qtde: number | string;
  fatorembalagem: number | string; // fator de embalagem (FATORCX, unidades/caixa)
  vrcusto: number | string;
  qtdtotal?: number | string | null; // = qtde × fatorembalagem (unidades)
  totalcusto?: number | string | null; // = qtde × vlrembalagem (total da linha)
  vlrembalagem?: number | string | null; // = fatorembalagem × vrcusto (custo por caixa)
  desconto?: number | string | null;
  descontop?: number | string | null;
  obs?: string | null;
  vrcustoliquido?: number | string | null;
  markup?: number | string | null;
  vrvenda?: number | string | null;
  vrvendasug?: number | string | null;
  margeml2?: number | string | null;
  margeml2v?: number | string | null;
  pmz?: number | string | null;
  bonificacao?: number | string | null; // % bonificado (100 no espelho)
}

/** Override de SUPERVISOR p/ liberar o limite (E8 c3): login+senha do supervisor autorizado. */
export const liberarLimiteSupervisorSchema = z.object({
  login: z.string().trim().min(1, 'Informe o login do supervisor.').max(50),
  senha: z.string().min(1, 'Informe a senha do supervisor.').max(200),
});
export type LiberarLimiteSupervisorDto = z.infer<typeof liberarLimiteSupervisorSchema>;
