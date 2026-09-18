import { z } from 'zod';

/** EXTRATO DE CLIENTES (`FRMEXTRATOCLIENTES`) — quatro modelos sobre o A Receber. */
export const extratoClientesSchema = z.object({
  /** os quatro `rgModelo` do legado. */
  modelo: z.enum(['periodo', 'refMenor', 'refMaior', 'saldo']).default('periodo'),
  /** o `rgDatas`: emissão (DTVENDA), vencimento (DTVENC) ou baixa (DTPGTO). */
  campoData: z.enum(['emissao', 'vencimento', 'baixa']).default('emissao'),
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** só o modelo período usa; nos outros a referência é `dataIni`. */
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['aberto', 'baixado', 'todos']).default('todos'),
  codparceiro: z.coerce.number().int().positive().optional(),
  /** teto de valor do modelo saldo (`edtValor`). */
  valorMax: z.coerce.number().positive().optional(),
  tipo: z.enum(['analitico', 'sintetico']).default('analitico'),
  limite: z.coerce.number().int().positive().max(20000).default(5000),
}).refine((f) => f.modelo !== 'periodo' || (f.dataFim != null && f.dataFim >= f.dataIni), { message: 'o modelo período exige fim ≥ início', path: ['dataFim'] });
export type ExtratoClientesDto = z.infer<typeof extratoClientesSchema>;
