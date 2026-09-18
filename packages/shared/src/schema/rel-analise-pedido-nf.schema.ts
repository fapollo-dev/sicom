import { z } from 'zod';

/**
 * RELATÓRIO DE ANÁLISE PEDIDO × NF (`FRMRELANALISEPEDIDONF`).
 *
 * As análises do período (por data da análise), com notas e pedidos agregados, fornecedor e comprador; filtro
 * por fornecedor e comprador; "Expandido" embute o dossiê (divergentes / só na NF / só no pedido) em cada uma.
 */
export const relAnalisePedidoNfSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** fornecedor de algum pedido da análise (o `PC.CODPARCEIRO` do legado). */
  codparceiro: z.coerce.number().int().positive().optional(),
  /** comprador de algum pedido da análise (o `PC.USUCADASTRO` do legado; aqui `pedidocompra.codoperador`). */
  codcomprador: z.coerce.number().int().positive().optional(),
  expandido: z.coerce.boolean().default(false),
  limite: z.coerce.number().int().positive().max(2000).default(500),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type RelAnalisePedidoNfDto = z.infer<typeof relAnalisePedidoNfSchema>;
