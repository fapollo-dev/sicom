import { z } from 'zod';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** DEVOLUÇÃO DE VENDAS (`FRMDEVOLUCAOVENDAS`) — achar o cupom: por PDV+número ou por período. */
export const devolucaoVendasBuscaSchema = z.object({
  nrocupom: z.coerce.number().int().positive().optional(),
  nropdv: z.coerce.number().int().nonnegative().optional(),
  nropedido: z.string().trim().max(20).optional(),
  dataIni: dia.optional(),
  dataFim: dia.optional(),
  codparceiro: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().max(5000).default(500),
}).refine((f) => f.nrocupom != null || f.nropedido != null || (f.dataIni != null && f.dataFim != null), {
  message: 'informe o cupom, o pedido, ou um período', path: ['nrocupom'],
});
export type DevolucaoVendasBuscaDto = z.infer<typeof devolucaoVendasBuscaSchema>;

/** registrar a devolução dos itens marcados (não mexe no estoque — regra do legado). */
export const devolucaoVendasRegistrarSchema = z.object({
  codmotivoop: z.coerce.number().int().positive().optional(),
  itens: z.array(z.object({
    codvendas: z.coerce.number().int().positive(),
    nroitem: z.coerce.number().int().nonnegative(),
    codproduto: z.coerce.number().int().positive(),
    qtdeDevolvido: z.coerce.number().positive(),
  })).min(1).max(500),
});
export type DevolucaoVendasRegistrarDto = z.infer<typeof devolucaoVendasRegistrarSchema>;

/** reverter o registro (volta a venda ao estado anterior). */
export const devolucaoVendasReverterSchema = z.object({
  itens: z.array(z.object({
    codvendas: z.coerce.number().int().positive(),
    nroitem: z.coerce.number().int().nonnegative(),
    codproduto: z.coerce.number().int().positive(),
  })).min(1).max(500),
});
export type DevolucaoVendasReverterDto = z.infer<typeof devolucaoVendasReverterSchema>;

/** as devoluções já registradas no período. */
export const devolucaoVendasConsultaSchema = z.object({
  dataIni: dia,
  dataFim: dia,
  codmotivoop: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().max(20000).default(2000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type DevolucaoVendasConsultaDto = z.infer<typeof devolucaoVendasConsultaSchema>;
