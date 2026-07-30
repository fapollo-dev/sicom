import { z } from 'zod';

/**
 * CONCILIAÇÃO BANCÁRIA (OFX) (FRMCONCILIACAOBANCARIA) corte-1: importa as linhas do extrato (já parseadas — o parser
 * do arquivo .ofx é adiado) e concilia contra o razão interno (mov_contas_bancarias) marcando os dois lados.
 */

/** 1 linha do extrato (OFX já parseado). */
export const ofxLinhaSchema = z.object({
  data: z.string().min(1, 'Informe a data da transação.'), // ISO 'YYYY-MM-DD'
  valor: z.coerce.number().positive({ message: 'O valor deve ser maior que zero.' }),
  credito_debito: z.enum(['C', 'D']),
  descricao: z.string().max(250).optional(),
  transacao_id: z.string().max(255).optional(), // FITID (spec OFX A-255; alargado na mig 121)
  check_num: z.string().max(20).optional(),
});
export type OfxLinhaDto = z.infer<typeof ofxLinhaSchema>;

export const importarOfxSchema = z.object({
  codconta: z.coerce.number().int().positive({ message: 'Informe a conta bancária.' }),
  nomeArquivo: z.string().max(250).optional(),
  linhas: z.array(ofxLinhaSchema).min(1, 'Informe ao menos uma linha do extrato.').max(10000),
});
export type ImportarOfxDto = z.infer<typeof importarOfxSchema>;

/** importar direto de um arquivo .ofx (corte-2): o cliente lê o arquivo como TEXTO e envia o conteúdo — o servidor
 *  parseia (OFX 1.x SGML / 2.x XML) e reusa a ingestão do corte-1 (dedup por FITID). */
export const importarOfxArquivoSchema = z.object({
  codconta: z.coerce.number().int().positive({ message: 'Informe a conta bancária.' }),
  nomeArquivo: z.string().max(250).optional(),
  conteudo: z.string().min(1, 'Arquivo OFX vazio.').max(5_000_000),
});
export type ImportarOfxArquivoDto = z.infer<typeof importarOfxArquivoSchema>;

/** conciliar: N linhas do extrato ↔ N lançamentos do razão (Σ valores iguais) → 1 evento CB. */
export const conciliarSchema = z.object({
  codconta: z.coerce.number().int().positive(),
  mboIds: z.array(z.coerce.number().int().positive()).min(1, 'Selecione ao menos uma linha do extrato.'),
  codmovcontas: z.array(z.coerce.number().int().positive()).min(1, 'Selecione ao menos um lançamento do razão.'),
});
export type ConciliarDto = z.infer<typeof conciliarSchema>;
