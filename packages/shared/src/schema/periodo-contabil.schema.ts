import { z } from 'zod';

const flag = z.enum(['S', 'N']).default('N');
/** competência MMAAAA — o legado aceita '082024' e '02/2025'; aqui normaliza-se na gravação. */
const competencia = z.string().trim().regex(/^(0[1-9]|1[0-2])\/?\d{4}$/, 'competência no formato MMAAAA');

/** CADASTRO DE PERÍODO CONTÁBIL (`FRMCADPERIODOCONTABIL`) — de onde saem as travas de período fechado. */
export const periodoContabilSchema = z.object({
  competenciaContabil: competencia,
  competenciaFinanceira: competencia.optional(),
  competenciaGeracao: competencia.optional(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 'S' fechado / 'N' aberto — o STATUS do legado. */
  status: flag,
  bloqNf: flag, bloqApg: flag, bloqBaixaApg: flag, bloqRcb: flag, bloqBaixaRcb: flag,
  bloqMovCaixa: flag, bloqChq: flag, bloqAdiantamentoForn: flag, bloqBaixaCrt: flag,
}).refine((p) => p.dataFim >= p.dataInicio, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type PeriodoContabilDto = z.infer<typeof periodoContabilSchema>;
