import { z } from 'zod';

/**
 * RELATÓRIO FINANCEIRO (`FRMRELFINANCEIRO`, `UrelFinanceiro.pas`).
 *
 * Recebíveis e compromissos lado a lado, no mesmo período e com os mesmos filtros.
 */

/** o `rgFiltro` do legado: por que DATA o período filtra. */
export const DATAS_REL_FINANCEIRO = [
  { value: 'EMISSAO', label: 'Emissão' },
  { value: 'VENCIMENTO', label: 'Vencimento' },
  { value: 'BAIXA', label: 'Baixa' },
] as const;

/** o `rgTipo`: todos, em aberto ou baixados. */
export const SITUACOES_REL_FINANCEIRO = ['TODOS', 'ABERTO', 'BAIXADO'] as const;

export const relFinanceiroSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** os dois checkboxes do legado; pelo menos um tem de estar ligado. */
  recebiveis: z.enum(['S', 'N']).default('S'),
  compromissos: z.enum(['S', 'N']).default('S'),
  filtroData: z.enum(['EMISSAO', 'VENCIMENTO', 'BAIXA']).default('VENCIMENTO'),
  situacao: z.enum(SITUACOES_REL_FINANCEIRO).default('TODOS'),
  parceiro: z.string().trim().max(120).optional(),
  codconta: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().max(20000).default(2000),
})
  .refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] })
  .refine((f) => f.recebiveis === 'S' || f.compromissos === 'S', {
    message: 'escolha recebíveis, compromissos ou os dois', path: ['recebiveis'],
  });

export type RelFinanceiroDto = z.infer<typeof relFinanceiroSchema>;
