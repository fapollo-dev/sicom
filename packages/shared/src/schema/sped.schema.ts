import { z } from 'zod';

/**
 * SPED (EFD-Contribuições) — geração por PERÍODO (DT_INI/DT_FIN). Datas ISO (YYYY-MM-DD). Scaffold corte-1:
 * só o envelope (bloco 0 + 9). O período dirige o COD_VER do leiaute e o filtro dos documentos (corte-2).
 */
export const gerarSpedSchema = z
  .object({
    dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Data inicial inválida (YYYY-MM-DD).'),
    dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Data final inválida (YYYY-MM-DD).'),
    /** a tela do SPED Contribuições exige a apuração do período (PreparaGeracaoSPED: "Não existe apuração para o periodo informado!") */
    exigirApuracao: z.boolean().optional(),
    /**
     * o Bloco H do SPED Fiscal ("Gerar H001 (Inventário)" + "Data Inventário" + "Mot. inventário - H005" + "Correção Tributária",
     * Uspedfiscal.dfm): sem ele o H001 sai sem dados (o padrão da tela)
     */
    /** o "C113 / 114" do SPED Fiscal (marcado por padrão na tela do legado): false tira os documentos referenciados */
    c113c114: z.boolean().optional(),
    // as demais opções da tela do SPED Fiscal (ausente = o padrão do .dfm)
    finalidade: z.union([z.literal(0), z.literal(1)]).optional(),
    entradas: z.boolean().optional(),
    saidas: z.boolean().optional(),
    codigoProduto: z.enum(['ean', 'plu']).optional(),
    somarIcmsStOutras: z.boolean().optional(),
    somarFcpStOutras: z.boolean().optional(),
    somarIpiOutras: z.boolean().optional(),
    zerado5929C170: z.boolean().optional(),
    zerado5929Documento: z.boolean().optional(),
    cst49: z.boolean().optional(),
    c170Proprias: z.boolean().optional(),
    gerarIcmsSt: z.boolean().optional(),
    destacarIpiStItem: z.boolean().optional(),
    c140: z.boolean().optional(),
    c140TodosModelos: z.boolean().optional(),
    c191: z.boolean().optional(),
    inventario: z
      .object({
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data do inventário.'),
        motivo: z.coerce.number().int().min(1).max(5).default(1),
        correcao: z.boolean().optional(),
      })
      .optional(),
  })
  .superRefine((d, ctx) => {
    if (d.dtfim.slice(0, 10) < d.dtini.slice(0, 10)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dtfim'], message: 'A data final não pode ser anterior à inicial.' });
    }
  });
export type GerarSpedDto = z.infer<typeof gerarSpedSchema>;
