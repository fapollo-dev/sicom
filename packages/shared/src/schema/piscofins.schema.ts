import { z } from 'zod';

const aliq = z.coerce.number().min(0).max(100).default(0);
const cst = z.coerce.number().int().min(0).max(99).nullable().optional();

/** CADASTRO DE PIS/COFINS (`FRMCADPISCOFINS`) — as situações que `produtos.idpiscofins` aponta. */
export const pisCofinsSchema = z.object({
  descricao: z.string().trim().min(1).max(80),
  aliqPisEnt: aliq, aliqPisSai: aliq, aliqCofinsEnt: aliq, aliqCofinsSai: aliq,
  cstPisEnt: cst, cstPisSai: cst, cstCofinsEnt: cst, cstCofinsSai: cst,
  /** tabela 4.3.6 do SPED (`pc_tipocredito`). */
  idTipoCredito: z.coerce.number().int().positive().nullable().optional(),
  exigeNatureza: z.enum(['S', 'N']).nullable().optional(),
});
export type PisCofinsDto = z.infer<typeof pisCofinsSchema>;
