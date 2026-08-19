import { z } from 'zod';

/** PENDÊNCIAS DO OPERADOR — a fila de trabalho (APN/RPN/CFN, Aberta/Finalizada). */
export const pendenciaListarSchema = z.object({
  codoperador: z.coerce.number().int().positive().optional(),
  status: z.enum(['A', 'F', 'E']).optional(),
  tipo: z.enum(['APN', 'RPN', 'CFN']).optional(),
});
export type PendenciaListarDto = z.infer<typeof pendenciaListarSchema>;

export const pendenciaCriarSchema = z.object({
  codoperador: z.coerce.number().int().positive(),
  tipo: z.enum(['APN', 'RPN', 'CFN']),
  complemento: z.string().max(250).optional(),
  observacao: z.string().max(1000).optional(),
});
export type PendenciaCriarDto = z.infer<typeof pendenciaCriarSchema>;

export const pendenciaStatusSchema = z.object({
  po_id: z.coerce.number().int().positive(),
  finalizar: z.boolean(),
  observacao: z.string().max(1000).optional(),
});
export type PendenciaStatusDto = z.infer<typeof pendenciaStatusSchema>;

/** corte-2a: abrir a análise vinculada (PO_COMPLEMENTO da APN/RPN = APN_ID da análise persistida). */
export const pendenciaAnaliseSchema = z.object({
  apn_id: z.coerce.number().int().positive(),
});
export type PendenciaAnaliseDto = z.infer<typeof pendenciaAnaliseSchema>;

/**
 * MOTOR da análise (corte-2b): criar a análise a partir dos pedidos + notas escolhidos e processá-la.
 * `total_parcial` decide se a diferença de QUANTIDADE conta ('T' total) ou não ('P' parcial).
 */
export const analiseCriarSchema = z.object({
  codpedcomps: z.array(z.coerce.number().int().positive()).min(1, 'Selecione pelo menos um pedido.').max(200),
  refs_nf: z.array(z.coerce.number().int().positive()).min(1, 'A nota fiscal não foi informada.').max(200),
  total_parcial: z.enum(['T', 'P']).optional(),
});
export type AnaliseCriarDto = z.infer<typeof analiseCriarSchema>;

export const analiseProcessarSchema = z.object({ apn_id: z.coerce.number().int().positive() });
export type AnaliseProcessarDto = z.infer<typeof analiseProcessarSchema>;

/**
 * LIBERAR a análise (corte-2c): finaliza, encerra a pendência e fecha o pedido. Com divergência o legado
 * EXIGE gerar o financeiro (o título a receber da diferença contra o fornecedor).
 */
export const analiseLiberarSchema = z.object({
  apn_id: z.coerce.number().int().positive(),
  fechar_pedido: z.boolean().optional(),
  gerar_financeiro: z.boolean().optional(),
  /** quando a análise tem vários compradores e o operador não pode liberar, o legado abre um picker para escolher
   *  para QUEM vai a pendência (`SelecionaOperadorComprador`); aqui a escolha vem no DTO. */
  codoperador_comprador: z.coerce.number().int().positive().optional(),
});
export type AnaliseLiberarDto = z.infer<typeof analiseLiberarSchema>;

/** REFAZER (fluxo RPN): nova análise com os mesmos pedidos/notas, processada, encerrando a pendência antiga. */
export const analiseRefazerSchema = z.object({ apn_id: z.coerce.number().int().positive() });
export type AnaliseRefazerDto = z.infer<typeof analiseRefazerSchema>;

/** GERAR PENDÊNCIA PARA O ANALISTA (tipo RPN: "Realize uma nova análise…") — `GeraPendenciaAnalista`. */
export const analisePendenciaAnalistaSchema = z.object({ apn_id: z.coerce.number().int().positive() });
export type AnalisePendenciaAnalistaDto = z.infer<typeof analisePendenciaAnalistaSchema>;

/** O DOSSIÊ da análise para impressão (`ImprimirAnalise`): cabeçalho + as três listas. */
export const analiseDossieSchema = z.object({ apn_id: z.coerce.number().int().positive() });
export type AnaliseDossieDto = z.infer<typeof analiseDossieSchema>;

/**
 * EXCLUIR A CONFERÊNCIA da nota (`btnExcluirConferenciaClick`): zera o vínculo da NF com o pedido. Exige a **senha
 * administrativa** e a nota — pela PK (`codnf`) ou pela chave da nota não cadastrada.
 */
export const analiseExcluirConferenciaSchema = z
  .object({
    codnf: z.coerce.number().int().positive().optional(),
    chavenfe: z.string().trim().length(44, { message: 'A chave da NFe tem 44 dígitos.' }).optional(),
    senha: z.string().min(1, { message: 'Informe a senha administrativa.' }),
  })
  .refine((v) => v.codnf != null || v.chavenfe != null, { message: 'Informe a nota (código ou chave).', path: ['codnf'] });
export type AnaliseExcluirConferenciaDto = z.infer<typeof analiseExcluirConferenciaSchema>;
