import { z } from 'zod';
import { boolQuery } from './bool-query';

/** BALANÇO PATRIMONIAL (`FRMRELBALANCO`) — ativo e passivo numa data. Os controles e os padrões do `uRelBalanco.dfm`. */
export const relBalancoSchema = z.object({
  /** "Saldos em": o "movimento do mês" vai do 1º dia do mês dela até ela (regra do legado). */
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** "Imprime Contas Analíticas" — **desmarcado** no legado: sem ele o SQL pede `CLASSE = 'S'` (nenhuma conta do cliente tem). */
  analiticas: boolQuery(false),
  /** "Imprime Contas sem Movimento" (desmarcado). */
  semMovimento: boolQuery(false),
  /** "Descrições em Degrau" (marcado): um espaço por posição do código antes da descrição (até 20). */
  degrau: boolQuery(true),
  /** "Página Inicial" (1). */
  pagina: z.coerce.number().int().min(0).max(99999).default(1),
  /** as lojas (`GetMultiEmpresa`); sem elas, a do login. */
  empresas: z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.coerce.number().int().positive()).optional()),
});
export type RelBalancoDto = z.infer<typeof relBalancoSchema>;
