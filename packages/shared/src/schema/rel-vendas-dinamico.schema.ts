import { z } from 'zod';

/**
 * ANÁLISE DE VENDAS DE PRODUTOS (`FRMRELATORIOVENDASDINAMICO`, `uRelatorioVendasDinamico.pas`).
 *
 * Uma linha por produto com o giro do período ao lado do cadastro: quanto vendeu, quanto custou, quando foi a
 * última venda, quando foi a última compra e por quanto, e o que tem em estoque.
 */
export const relVendasDinamicoSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** o legado tem hora nas duas pontas (`edtHora1`/`edtHora2`). */
  horaIni: z.string().regex(/^\d{2}:\d{2}$/).default('00:00'),
  horaFim: z.string().regex(/^\d{2}:\d{2}$/).default('23:59'),
  codfor: z.coerce.number().int().positive().optional(),
  coddpto: z.coerce.number().int().positive().optional(),
  codgrupo: z.coerce.number().int().positive().optional(),
  codsubgrupo: z.coerce.number().int().positive().optional(),
  produto: z.string().trim().max(120).optional(),
  /** o legado fixa `ATIVO_COMPRA='S'`; aqui é escolha, com o mesmo padrão. */
  somenteAtivoCompra: z.enum(['S', 'N']).default('S'),
  limite: z.coerce.number().int().positive().max(20000).default(5000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });

export type RelVendasDinamicoDto = z.infer<typeof relVendasDinamicoSchema>;
