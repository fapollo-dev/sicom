import { z } from 'zod';

/**
 * CONFIGURAÇÕES DO PLANO DE CONTAS (`FRMCADCONFPLANOCONTAS`, `uCadConfPlanoContas.pas`).
 *
 * Duas coisas: a **máscara** (quantos dígitos cada nível do código tem) e as **contas padrão** por natureza
 * de parceiro — o que um fornecedor sem conta própria herda na hora de contabilizar.
 */

/** o legado tem oito níveis (`NDIG_1..NDIG_8`); o cliente usa cinco e deixa o resto nulo. */
export const NIVEIS_PLANO = 8;

export const confPlanoContasSchema = z.object({
  /** `E` empresarial · `R` referencial — o retaguarda usa `E`. */
  tipo: z.enum(['E', 'R']).default('E'),
  /** larguras por nível, na ordem. No cliente: `[1,1,2,2,5]`. */
  niveis: z.array(z.coerce.number().int().min(1).max(9)).min(1).max(NIVEIS_PLANO),
  descricao: z.string().trim().max(60).nullish(),
  codcontasintetica_for: z.coerce.number().int().positive().nullish(),
  codcontaanalitica_for: z.coerce.number().int().positive().nullish(),
  codcontasintetica_cli: z.coerce.number().int().positive().nullish(),
  codcontaanalitica_cli: z.coerce.number().int().positive().nullish(),
  codcontasintetica_cxa: z.coerce.number().int().positive().nullish(),
  codcontaanalitica_cxa: z.coerce.number().int().positive().nullish(),
  codcontasintetica_bco: z.coerce.number().int().positive().nullish(),
  codcontaanalitica_bco: z.coerce.number().int().positive().nullish(),
});

export type ConfPlanoContasDto = z.infer<typeof confPlanoContasSchema>;

/** a máscara como o operador a lê: `[1,1,2,2,5]` vira `9.9.99.99.99999`. */
export const mascaraVisivel = (niveis: number[]) => niveis.map((n) => '9'.repeat(n)).join('.');

/** um código de exemplo com a máscara: `[1,1,2,2,5]` vira `1.1.01.01.00001`. */
export const exemploCodigo = (niveis: number[]) =>
  niveis.map((n, i) => (i === 0 ? '1'.padStart(n, '0') : '1'.padStart(n, '0'))).join('.');
