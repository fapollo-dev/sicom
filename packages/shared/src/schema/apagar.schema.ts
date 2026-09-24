import { z } from 'zod';

/**
 * CONTAS A PAGAR (uCadAPagar) — gêmea de A Receber. Cadastro/gestão do título (grava APAGAR) +
 * baixa/pagamento (APAGAR_BX). Multi-tenant por CODEMPRESA. O parceiro é o FORNECEDOR. Reusa o
 * `baixarTituloSchema` de areceber (idêntico). Mensagens em PT (ADR-015).
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

const stripNulls = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const x = stripNulls(val);
      if (x !== undefined) o[k] = x;
    }
    return o;
  }
  return v === null ? undefined : v;
};

const apagarBase = z.object({
  codparceiro: z.number({ message: 'Informe o fornecedor do documento.' }).int('Fornecedor inválido.'),
  dtvenda: z.string().min(1, 'Informe a data de compra/emissão.'),
  dtvenc: z.string().min(1, 'Informe a data de vencimento.'),
  valor: dec(z.number().positive('O valor da parcela deve ser maior que zero.')),
  txjuros: dec(z.number().min(0)),
  txmulta: dec(z.number().min(0)),
  desconto_boleto: dec(z.number().min(0)),
  // o desconto e os embutidos (acréscimo) do título — uAPagar `edtDesconto`/`edtVendor`
  desconto: dec(z.number().min(0, 'O desconto não pode ser negativo.')),
  vendor: dec(z.number().min(0, 'Os embutidos não podem ser negativos.')),
  nrodup: opcional(z.number().int().min(1, 'Mínimo 1 parcela.').max(200, 'Máximo de 200 parcelas.')),
  duplicata: opcional(z.string().max(20)),
  tipodoc: opcional(z.string().max(25)),
  nroped: opcional(z.string().max(20)),
  nrocupom: opcional(z.string().max(20)),
  idpgto: opcional(z.number().int()),
  codbco: opcional(z.number().int()),
  codplc: opcional(z.number().int()),
  idsituacao_nf: opcional(z.number().int()),
  obs: opcional(z.string()),
});

const refineDatas = (d: { dtvenda?: string; dtvenc?: string }, ctx: z.RefinementCtx) => {
  if (d.dtvenda && d.dtvenc && d.dtvenc < d.dtvenda) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dtvenc'], message: 'O vencimento não pode ser anterior à data de compra.' });
  }
};

export const apagarSchema = z.preprocess(stripNulls, apagarBase).superRefine(refineDatas as any);

/** AGRUPAMENTO A PAGAR (uAgrupaContasAPagar) — consolida ≥2 títulos ABERTOS do MESMO fornecedor. `dtvenc`
 *  opcional = vencimento do consolidado (default HOJE). Gêmeo do agruparAreceberSchema. */
export const agruparApagarSchema = z.object({
  codapgs: z.array(z.coerce.number().int().positive()).min(1, 'Nenhum documento foi selecionado para realizar o agrupamento.').max(5000, 'Máximo de 5.000 títulos por agrupamento.'),
  codparceiro: opcional(z.coerce.number().int().positive()),
  dtvenc: opcional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de vencimento inválida (use AAAA-MM-DD).')),
  obs: opcional(z.string().max(1000)),
  codplc: opcional(z.coerce.number().int().positive()),
  parcelas: z.array(z.object({
    valor: z.coerce.number().positive('O valor da parcela deve ser maior que zero.'),
    dtvenc: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de vencimento inválida (use AAAA-MM-DD).'),
  })).max(200, 'O número de parcelas deve ser menor que 200.').optional(),
});
export type AgruparApagarDto = z.infer<typeof agruparApagarSchema>;
export const atualizarApagarSchema = z
  .preprocess(stripNulls, apagarBase.partial())
  .superRefine(refineDatas as any);

export type CriarApagarDto = z.infer<typeof apagarBase>;

export interface Apagar {
  codapg: number;
  codparceiro?: number;
  codempresa: number;
  razao?: string;
  dtvenda?: string;
  dtvenc?: string;
  dtpgto?: string;
  duplicata?: string;
  valor?: number | string;
  txjuros?: number | string;
  juro?: number | string;
  total?: number | string;
  dias_atrazo?: number;
  dias_tolerancia?: number;
  nrodup?: number;
  idnf?: number;
  quitada?: string;
  agrupado?: string;
  contabilizado?: string;
  tipodoc?: string;
  origem?: string;
  gerado?: string;
  cadastrado_manualmente?: string;
  consiliado?: string;
  idpgto?: number;
  codbco?: number;
  codplc?: number;
  idsituacao_nf?: number;
}
