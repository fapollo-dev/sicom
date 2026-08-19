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
