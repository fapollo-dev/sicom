import { z } from 'zod';

const dia = /^\d{4}-\d{2}-\d{2}$/;

/** os CFOPs que a tela sempre leva (`CfopPadrao`, uRelCurvaABCFornecedor.pas:66) — a compra para comercialização */
export const CFOPS_PADRAO_CURVA_ABC_FORNECEDOR = [1102, 2102, 1403, 2403] as const;

/**
 * CURVA ABC POR FORNECEDOR (`FRMRELCURVAABCFORNECEDOR`) — a curva das COMPRAS: as notas de entrada processadas do período por
 * fornecedor e loja. O fornecedor é o texto da razão com o modo que o `TfrmFiltro` do legado pergunta (igual, começa, termina, contém).
 */
export const relCurvaAbcFornecedorSchema = z.object({
  dataIni: z.string().regex(dia, 'Período inicial deve ser informado. Verifique!'),
  dataFim: z.string().regex(dia, 'Período final deve ser informado. Verifique!'),
  /** RbtDataContabil (marcado no .dfm) × RbtDataEmissao */
  tipoData: z.enum(['contabil', 'emissao']).default('contabil'),
  fornecedor: z.string().trim().max(100).optional(),
  modoFornecedor: z.enum(['igual', 'comeca', 'termina', 'contem']).default('contem'),
  /** a lista do edtCFOP; vazia = a padrão (SetCfopsEditDefault) */
  cfops: z.array(z.coerce.number().int().positive().max(9999)).max(300).optional(),
  /** "Mostrar vendas" (ChbMostrarSaidas) */
  mostrarSaidas: z.boolean().default(false),
  /** as lojas do GetMultiEmpresa; vazio = a do login */
  empresas: z.array(z.coerce.number().int().positive()).max(50).optional(),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'O período final não pode ser antes do inicial.', path: ['dataFim'] });
export type RelCurvaAbcFornecedorDto = z.infer<typeof relCurvaAbcFornecedorSchema>;
