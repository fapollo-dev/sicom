import { z } from 'zod';

/**
 * CONSULTA DE HISTÓRICO DE VENDAS (FRMCONSHISTVENDAS) — corte-1: a consulta de UM cupom.
 * A tela exige cupom E PDV ("Informe o número do cupom" / "Informe o número do PDV"), e o PDV não é coluna: é o
 * **prefixo de 2 dígitos do NROPEDIDO** (`PDV(2)+DDMMYY(6)+HHMMSS(6)` — dossiê uConsHistVendas.md §2).
 * Mas o legado tem uma SEGUNDA porta: `ChamaFrmConsHistVendas`/`ExisteVenda` (uConsHistVendas.pas:478-511 e
 * 625-648) abrem a consulta com **só o NROPEDIDO** — é assim que A Receber, Cheque e Cartão (épicos já migrados)
 * pulam para a venda. Por isso `nrocupom`/`pdv` são opcionais QUANDO vem `nropedido`.
 */
export const consHistVendasSchema = z
  .object({
    nrocupom: z.coerce.number({ required_error: 'Informe o número do cupom' }).int().nonnegative({ message: 'Informe o número do cupom' }).optional(),
    pdv: z.coerce.number({ required_error: 'Informe o número do PDV' }).int().min(0).max(99, { message: 'O PDV tem 2 dígitos (00 a 99).' }).optional(),
    /** empresa alternativa (o legado deixa digitar; exige o grant DELA no servidor). */
    idempresa: z.coerce.number().int().positive().optional(),
    /** ramo do filtro NFC-e (`COALESCE(VENDA_NFC,'N') = :VENDA_NFC`); default 'S' — 100% do golden. */
    venda_nfc: z.enum(['S', 'N']).optional(),
    /** o número do pedido: filtro exato quando há cupom/PDV, ou a porta de entrada sozinho. */
    nropedido: z.string().trim().max(20).optional(),
  })
  .refine((v) => v.nropedido != null || (v.nrocupom != null && v.pdv != null), {
    message: 'Informe o número do cupom e do PDV (ou o número do pedido).',
    path: ['nrocupom'],
  });
export type ConsHistVendasDto = z.infer<typeof consHistVendasSchema>;

/**
 * A LISTA/PESQUISA de vendas (`BitBtn1Click` → `TfrmPesquisa` sobre a view GET_HIST_VENDAS): é como o operador ACHA
 * a venda quando não tem o cupom na mão. O recorte de DATAS é obrigatório aqui — no Oracle a view agrega as
 * 11,9 milhões de linhas de VENDAS e um `select` sem filtro estoura 180s (o legado sempre passa empresa + filtro).
 */
export const histVendasListarSchema = z
  .object({
    /** o legado NÃO exige data (o frmPesquisa busca por cupom/pedido em todo o histórico) — aqui as datas são
     *  obrigatórias **só** quando não vem identificador, porque sem nenhum filtro a view varre 11,9M linhas. */
    dtini: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (use AAAA-MM-DD).').optional(),
    dtfim: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (use AAAA-MM-DD).').optional(),
    /** filtros do frmPesquisa: cupom, pedido (prefixo ou completo), cliente (razão) e PDV. */
    nrocupom: z.coerce.number().int().nonnegative().optional(),
    nropedido: z.string().trim().max(20).optional(),
    cliente: z.string().trim().max(60).optional(),
    pdv: z.coerce.number().int().min(0).max(99).optional(),
    /** multi-empresa: o legado filtra `IDEMPRESA in (GetMultiEmpresa)` — as empresas do operador. */
    idempresas: z.array(z.coerce.number().int().positive()).max(20).optional(),
    /** 'C' = só cupons cancelados · 'N' = só não cancelados (no legado o filtro está comentado; aqui é opcional). */
    cancelado: z.enum(['C', 'N']).optional(),
    limite: z.coerce.number().int().positive().max(5000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.dtini != null && v.dtfim != null && v.dtfim < v.dtini)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dtfim'], message: 'A data final deve ser maior ou igual à inicial.' });
    if ((v.dtini == null) !== (v.dtfim == null))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dtfim'], message: 'Informe as duas datas do período.' });
    if (v.dtini == null && v.nrocupom == null && !v.nropedido)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dtini'], message: 'Informe o período, ou o cupom/pedido que procura.' });
  });
export type HistVendasListarDto = z.infer<typeof histVendasListarSchema>;
