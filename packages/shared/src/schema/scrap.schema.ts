import { z } from 'zod';

/**
 * SCRAP / PERDAS (FRMCADSCRAP — uCadSCRAP) — corte-1: REGISTRO + BAIXA de estoque. Agregado mestre-detalhe
 * (cabeçalho `scrap` + itens `scrap_item`). O operador informa produto + quantidade + motivo (+ setor/fornecedor);
 * o custo (vr_custo/vrcustorep) é SNAPSHOT server-authoritative de MULTI_PRECO (igual ao Inventário). Valor da
 * perda = qtde × vr_custo. qtde é SIGNED (o golden tem qtde<0/=0 = estornos/correções — não clampar). A baixa de
 * estoque é aplicada por um passo `aplicar`/`estornar` (mov_estoque='S'). empresaScoped; exclusão física (sem INDR).
 */

const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

const dec = (inner: z.ZodNumber = z.number()) =>
  z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  }, inner.optional());

/** Item da perda: operador informa produto + qtde + motivo; custo/reposição vêm do servidor (MULTI_PRECO). */
export const scrapItemSchema = z.object({
  idproduto: z.coerce.number().int().positive({ message: 'Informe o produto.' }),
  qtde: z.coerce.number(), // SIGNED (fiel ao golden: negativos/zero = estorno/correção)
  codmotivoop: dec(z.number().int()), // motivo (MOTIVOS_OPERACAO PERDA) — opcional (config INFORMA_MOTIVO_PERDA)
  codsetor: dec(z.number().int()),
  codfor: dec(z.number().int()),
  idproduto_filho: dec(z.number().int()),
  origem_estoque: opcional(z.string().max(1)),
  // vr_custo/vrcustorep NÃO entram no input: são SNAPSHOT server-authoritative de MULTI_PRECO (o operador não
  // digita o custo — o valor da perda não é forjável pelo cliente).
  obs: opcional(z.string().max(300)),
});
export type ScrapItemDto = z.infer<typeof scrapItemSchema>;

export const scrapSchema = z.object({
  dt_cadastro: opcional(z.string()), // ISO; default = agora no service
  codplc: dec(z.number().int()), // centro de custo (PLC)
  codparceiro: dec(z.number().int()), // fornecedor
  idsituacao_nf: dec(z.number().int()),
  obs: opcional(z.string().max(300)),
  itens: z.array(scrapItemSchema).max(5000).optional(),
});
export type ScrapDto = z.infer<typeof scrapSchema>;
export const atualizarScrapSchema = scrapSchema.partial();
export type AtualizarScrapDto = z.infer<typeof atualizarScrapSchema>;
