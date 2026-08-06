import { z } from 'zod';

/**
 * CURVA ABC DE PRODUTOS VENDIDOS — relatório 09 do hub FRMRELVENDAS (uVendas.pas
 * TVendas.CurvaABCProdutosVendidos). Classifica os produtos do período pela participação ACUMULADA no
 * faturamento, contra os cortes PC_CURVA_ABC_A/B/C cadastrados na empresa.
 */
export const relCurvaAbcSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  /** «Filtrar Hora»: no SQL do legado é UMA JANELA CONTÍNUA dtini+hi → dtfim+hf, não uma faixa por dia. */
  filtrarHora: z.boolean().optional(),
  horaIni: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  horaFim: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  canceladas: z.enum(['N', 'S', 'T']).optional(),
  promocao: z.enum(['S', 'N', 'T']).optional(),
  produto: z.string().max(60).optional(),
  fornecedor: z.string().max(60).optional(),
  departamentos: z.array(z.coerce.number().int()).max(200).optional(),
  grupos: z.array(z.coerce.number().int()).max(200).optional(),
  subgrupos: z.array(z.coerce.number().int()).max(200).optional(),
  secoes: z.array(z.coerce.number().int()).max(200).optional(),
  aliquota: z.string().max(3).optional(),
  /** CkbExibirProdutosFilhos: agrupa pelo produto FILHO da venda em vez do pai. */
  exibirFilhos: z.boolean().optional(),
});
export type RelCurvaAbcDto = z.infer<typeof relCurvaAbcSchema>;
