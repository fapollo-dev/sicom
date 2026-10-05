import { z } from 'zod';
import { boolQuery } from './bool-query';

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
  /** comprador de algum pedido da análise (o `PC.USUCADASTRO` do legado — quem cadastrou o pedido). */
  codcomprador: z.coerce.number().int().positive().optional(),
  /**
   * o pedido (`PC.CODPEDCOMP`) — do binário novo: o V$SQL da produção (05/10/2026) traz `AND PC.CODPEDCOMP = 36257` e, com ele, nenhum
   * filtro de data
   */
  codpedcomp: z.coerce.number().int().positive().optional(),
  /** as lojas do `GetMultiEmpresa` (vírgula), recortadas às do operador */
  empresas: z.union([z.array(z.coerce.number().int().positive()), z.string()])
    .transform((v) => (typeof v === 'string' ? v.split(',').map((x) => Number(x.trim())).filter(Boolean) : v))
    .pipe(z.array(z.number().int().positive()).max(50)).optional(),
  expandido: boolQuery(false),
  limite: z.coerce.number().int().positive().max(2000).default(500),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type RelAnalisePedidoNfDto = z.infer<typeof relAnalisePedidoNfSchema>;
