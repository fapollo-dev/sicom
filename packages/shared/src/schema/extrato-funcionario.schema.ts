import { z } from 'zod';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** EXTRATO DE FUNCIONÁRIO (`FRMRELFUNCIONARIO`) — débitos (AR) e créditos (AP) do convênio de funcionários. */
export const extratoFuncionarioSchema = z.object({
  dataIni: dia,
  dataFim: dia,
  /** sintético = "1 - Extrato" (por funcionário × tipo × dia); analítico = "2/3" (linha a linha com centro de custo). */
  tipo: z.enum(['sintetico', 'analitico']).default('sintetico'),
  /** o convênio (parceiro que é `CODCONVENIO` de funcionários). */
  codconvenio: z.coerce.number().int().positive().optional(),
  codoperador: z.coerce.number().int().positive().optional(),
  situacao: z.enum(['quitados', 'abertos', 'todos']).default('todos'),
  /** o rádio "Tipo" do legado — recorte por texto da OBS. */
  filtro: z.enum(['todos', 'compra', 'adiantamento', 'quebra', 'estorno']).default('todos'),
  limite: z.coerce.number().int().positive().max(20000).default(5000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type ExtratoFuncionarioDto = z.infer<typeof extratoFuncionarioSchema>;
