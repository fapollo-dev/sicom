import { z } from 'zod';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** LIVRO DIÁRIO (`FRMRELDIARIOCONTABIL`) — os controles do `uRelDiarioContabil.dfm`: o período, a página inicial e as lojas. */
export const relDiarioContabilSchema = z.object({
  dataIni: dia,
  dataFim: dia,
  /** "Página inicial" (`edtPagina`, padrão 1): a variável PaginaInicial do layout. */
  pagina: z.coerce.number().int().min(0).max(99999).default(1),
  /** as lojas (`GetMultiEmpresa`); sem elas, a do login. */
  empresas: z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.coerce.number().int().positive()).optional()),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type RelDiarioContabilDto = z.infer<typeof relDiarioContabilSchema>;
