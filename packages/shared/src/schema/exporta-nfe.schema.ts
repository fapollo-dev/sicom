import { z } from 'zod';

/** EXPORTAÇÃO DE NF-e (`FRMEXPORTANFE`) — as notas eletrônicas do período e o XML de cada uma. */
export const exportaNfeSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  modelo: z.enum(['55', '65', 'todos']).default('55'),
  status: z.enum(['todas', 'autorizadas', 'canceladas']).default('todas'),
  limite: z.coerce.number().int().positive().max(5000).default(1000),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });
export type ExportaNfeDto = z.infer<typeof exportaNfeSchema>;

/** a grade de MANUTENÇÃO: as notas marcadas na Pesquisa (até 999 — uExportaNFe.pas:241-245) */
export const notasDaManutencaoSchema = z.object({
  codnfs: z.array(z.coerce.number().int().positive()).min(1).max(999, 'Permitido um máximo de 1000 registros para manutenção de nf-e.'),
});
export type NotasDaManutencaoDto = z.infer<typeof notasDaManutencaoSchema>;

/** o "Salvar XML NFe" (SalvaXMLNFe, udmNF.pas:5057): "Separado pelo número da nota" ou "Em uma unica pasta" */
export const salvarXmlNfeSchema = notasDaManutencaoSchema.extend({
  separarPorNumero: z.boolean().default(true),
});
export type SalvarXmlNfeDto = z.infer<typeof salvarXmlNfeSchema>;

