import { z } from 'zod';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** EXTRATO DE FUNCIONÁRIO (`FRMRELFUNCIONARIO`) — débitos (AR) e créditos (AP) do convênio de funcionários. */
export const extratoFuncionarioSchema = z.object({
  dataIni: dia,
  dataFim: dia,
  /**
   * o `CmbTipoRelatorio`: sintetico = "1 - Extrato de funcionário" (por funcionário × tipo × dia); analitico = "2 - … analítico" e
   * analitico_sintetico = "3 - … sintético" — os dois com o mesmo SQL linha a linha (centro de custo), em layouts diferentes.
   */
  tipo: z.enum(['sintetico', 'analitico', 'analitico_sintetico']).default('sintetico'),
  /** o `CmbNiveisExpandidos` da impressão (só o tipo 2 escolhe; o 1 imprime recolhido e o 3 com 1 nível) */
  niveis: z.coerce.number().int().min(0).max(2).optional(),
  /** o convênio (parceiro que é `CODCONVENIO` de funcionários). */
  codconvenio: z.coerce.number().int().positive().optional(),
  codoperador: z.coerce.number().int().positive().optional(),
  situacao: z.enum(['quitados', 'abertos', 'todos']).default('todos'),
  /** o rádio "Tipo" do legado — recorte por texto da OBS. */
  filtro: z.enum(['todos', 'compra', 'adiantamento', 'quebra', 'estorno']).default('todos'),
  limite: z.coerce.number().int().positive().max(20000).default(5000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type ExtratoFuncionarioDto = z.infer<typeof extratoFuncionarioSchema>;
