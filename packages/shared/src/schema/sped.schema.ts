import { z } from 'zod';

/**
 * SPED (EFD-Contribuições) — geração por PERÍODO (DT_INI/DT_FIN). Datas ISO (YYYY-MM-DD). Scaffold corte-1:
 * só o envelope (bloco 0 + 9). O período dirige o COD_VER do leiaute e o filtro dos documentos (corte-2).
 */
export const gerarSpedSchema = z
  .object({
    dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Data inicial inválida (YYYY-MM-DD).'),
    dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Data final inválida (YYYY-MM-DD).'),
  })
  .superRefine((d, ctx) => {
    if (d.dtfim.slice(0, 10) < d.dtini.slice(0, 10)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dtfim'], message: 'A data final não pode ser anterior à inicial.' });
    }
  });
export type GerarSpedDto = z.infer<typeof gerarSpedSchema>;
