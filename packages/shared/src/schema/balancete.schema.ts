import { z } from 'zod';
import { boolQuery } from './bool-query';

/** BALANCETE DE VERIFICAÇÃO (`FRMRELBALANCETE`). */
export const balanceteSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** faixa de contas pelo código expandido (`edtConta`/`edtConta2`); só a inicial = prefixo. */
  contaIni: z.string().trim().max(30).optional(),
  contaFim: z.string().trim().max(30).optional(),
  /**
   * `ComboBoxNivel` (1–8, 10, 15, 20, 25, 30; padrão 30): apesar do nome, é o **comprimento do código expandido**
   * (`LENGTH(PP.CODIEXPANDIDO) <= n` no SQL) — 1 = só as raízes, 15 = tudo no plano do cliente.
   */
  nivelMax: z.coerce.number().int().min(1).max(30).default(30),
  semMovimento: boolQuery(false),
  analiticas: boolQuery(true),
  /** `CheckBoxDegrau` (padrão marcado): a descrição com um espaço por posição do código (até 20). */
  degrau: boolQuery(true),
  /** `CheckBoxNegrito` (padrão marcado): a variável Negrito do layout (as contas T em negrito). */
  negrito: boolQuery(true),
  /** `edtPagina` (padrão 1): a variável PaginaInicial. */
  pagina: z.coerce.number().int().min(0).max(99999).default(1),
  /** as lojas (`GetMultiEmpresa`); sem elas, a do login. */
  empresas: z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.coerce.number().int().positive()).optional()),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type BalanceteDto = z.infer<typeof balanceteSchema>;
