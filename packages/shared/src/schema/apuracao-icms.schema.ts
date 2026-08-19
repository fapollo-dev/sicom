import { z } from 'zod';

/**
 * APURAÇÃO DE ICMS (FRMRELREGISTROS_ES / uRelRegistros_ES) — corte-1.
 * O operador escolhe o período e a empresa; o processo varre as três pernas (NF de saída, NFC-e de saída e NF de
 * entrada), grava o detalhe por documento×CST, o resumo por CFOP e o cabeçalho E110. Reprocessar é explícito: o
 * legado pergunta *"Ja existe apuração nesse período, deseja reprocessar?"* e, no "não", só recarrega o gravado.
 */
const dataIso = (campo: string) => z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, `${campo} inválida (use AAAA-MM-DD).`);

export const apuracaoIcmsProcessarSchema = z
  .object({
    dataini: dataIso('Data inicial'),
    datafin: dataIso('Data final'),
    /** false (default) = se já existe apuração do período, devolve a gravada sem recalcular (o "não" do legado). */
    reprocessar: z.boolean().optional(),
    /** os ajustes manuais do quadro (o legado tem um dataset para cada um). */
    outroscreditos: z.coerce.number().finite().min(0).optional(),
    estornodebitos: z.coerce.number().finite().min(0).optional(),
    outrosdebitos: z.coerce.number().finite().min(0).optional(),
    estornocreditos: z.coerce.number().finite().min(0).optional(),
    deducoes: z.coerce.number().finite().min(0).optional(),
  })
  .refine((v) => v.datafin >= v.dataini, { message: 'A data final deve ser maior ou igual à inicial.', path: ['datafin'] });
export type ApuracaoIcmsProcessarDto = z.infer<typeof apuracaoIcmsProcessarSchema>;

/** consulta de uma apuração já gravada (o `PopulaDadosApuracaoICMS` do legado). */
export const apuracaoIcmsObterSchema = z
  .object({
    codapuracaoicms: z.coerce.number().int().positive().optional(),
    dataini: dataIso('Data inicial').optional(),
    datafin: dataIso('Data final').optional(),
    /** teto do detalhe devolvido (uma apuração grande tem ~64 mil linhas no golden). */
    limite_detalhe: z.coerce.number().int().positive().max(5000).optional(),
  })
  .refine((v) => v.codapuracaoicms != null || (v.dataini != null && v.datafin != null), {
    message: 'Informe o código da apuração ou o período.',
    path: ['codapuracaoicms'],
  });
export type ApuracaoIcmsObterDto = z.infer<typeof apuracaoIcmsObterSchema>;
