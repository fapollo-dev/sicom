import { z } from 'zod';

/** MANIFESTO DO DFe (corte 1 local) — a fila das NF-e recebidas + ignorar com motivo. */
export const manifestoListarSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fornecedor: z.string().max(60).optional(),
  chave: z.string().max(50).optional(),
  cnpj: z.string().max(30).optional(),
  canceladas: z.enum(['TODOS', 'CANCELADAS', 'NAO_CANCELADAS']).optional(),
  pendentes: z.boolean().optional(),
  /** as chaves das notas recém-importadas pelo XML (`WHERE CHAVE IN (…)`) */
  chaves: z.array(z.string().min(44).max(50)).max(500).optional(),
});
export type ManifestoListarDto = z.infer<typeof manifestoListarSchema>;

/** a consulta por chave na SEFAZ (o "Consultar nota fiscal pela chave de acesso" do [F2]) */
export const manifestoChaveSchema = z.object({ chave: z.string().min(44).max(50) });
export type ManifestoChaveDto = z.infer<typeof manifestoChaveSchema>;

/** as notas marcadas (consulta forçada / exportar XML) */
export const manifestoChavesSchema = z.object({ chaves: z.array(z.string().min(44).max(50)).max(500) });
export type ManifestoChavesDto = z.infer<typeof manifestoChavesSchema>;

/** "Importar NF-e (XML)": os arquivos lidos no navegador */
export const manifestoImportarXmlSchema = z.object({
  arquivos: z.array(z.object({ nome: z.string().max(255), xml: z.string().max(4_000_000) })).min(1, 'Selecione pelo menos um registro para realizar a importação.').max(200),
});
export type ManifestoImportarXmlDto = z.infer<typeof manifestoImportarXmlSchema>;

export const manifestoIgnorarSchema = z.object({
  codnfe_naocad: z.coerce.number().int().positive(),
  /** obrigatório quando ignora (a tela do legado exige); dispensado ao reverter */
  motivo: z.string().max(255).optional(),
  reverter: z.boolean().optional(),
});
export type ManifestoIgnorarDto = z.infer<typeof manifestoIgnorarSchema>;

export const manifestarSchema = z.object({
  chave: z.string().min(44).max(50),
  evento: z.enum(['CIENCIA', 'CONFIRMACAO', 'DESCONHECIMENTO', 'OPERACAO_NAO_REALIZADA']),
  /** obrigatória só na operação não realizada (o serviço valida) */
  justificativa: z.string().max(255).optional(),
});
export type ManifestarDto = z.infer<typeof manifestarSchema>;

/** a manifestação das notas MARCADAS na grade (o legado envia uma por chave selecionada) */
export const manifestarLoteSchema = z.object({
  chaves: z.array(z.string().min(44).max(50)).min(1, 'Selecione pelo menos uma nota fiscal para realizar a manifestação.').max(500),
  evento: z.enum(['CIENCIA', 'CONFIRMACAO', 'DESCONHECIMENTO', 'OPERACAO_NAO_REALIZADA']),
  justificativa: z.string().max(255).optional(),
});
export type ManifestarLoteDto = z.infer<typeof manifestarLoteSchema>;
