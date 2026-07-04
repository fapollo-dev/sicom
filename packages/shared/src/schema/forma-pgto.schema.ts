import { z } from 'zod';

/**
 * FORMAS DE PAGAMENTO (uCadFormaPgto) — corte-1 (cadastro: núcleo + integração + flags). Modalidade
 * por IDEMPRESA (carimbada do contexto pelo engine, não vem do dto). PK IDPGTO é sequence (pkGerada).
 * DESTINO = chave de roteamento do fechamento (combo do legado + valores do dado real). Os 3 vínculos
 * (conta corrente/cofre/plano de contas) destravam o Caixa corte-2d. Validação fiel: DESTINO='QUE'
 * não recebe no PDV (uCadFormaPgto.pas). TEF/taxas/parcelamento/condições = corte-2.
 */

const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

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

/** DESTINO — roteamento financeiro (combo uCadFormaPgto.dfm:237 + valores reais do Oracle). */
export const FORMA_PGTO_DESTINO_OPCOES = [
  { value: 'CXA', label: 'Caixa / Dinheiro' },
  { value: 'RCB', label: 'A Receber' },
  { value: 'CHQ', label: 'Cheque' },
  { value: 'CHP', label: 'Cheque Pré' },
  { value: 'CRT', label: 'Cartão' },
  { value: 'TEF', label: 'Cartão (TEF)' },
  { value: 'PIX', label: 'PIX' },
  { value: 'QUE', label: 'Quebra de Caixa' },
  { value: 'DEV', label: 'Devolução' },
  { value: 'VTR', label: 'Vale-troco' },
] as const;

const DESTINO_VALUES = FORMA_PGTO_DESTINO_OPCOES.map((d) => d.value) as [string, ...string[]];

const formaPgtoBase = z.object({
  modalidade: z.string().trim().min(1, 'Informe a modalidade.').max(30, 'Modalidade muito longa (máx. 30).'),
  atalho: z.string().trim().min(1, 'Informe o atalho (tecla).').max(20, 'Atalho muito longo (máx. 20).'),
  // DESTINO é OBRIGATÓRIO (ValidaObrigatorio(cbbDestino), uCadFormaPgto.pas:324) — é a chave de
  // roteamento do fechamento. No create exige; no update partial vira opcional (base.partial()).
  destino: z.enum(DESTINO_VALUES, { message: 'Informe o destino da forma de pagamento.' }),
  // vínculos de integração (soft-ref; destravam o Caixa corte-2d)
  plccofre: opcional(z.number().int()),
  codcontacorrente: opcional(z.number().int()),
  codplanocontas: opcional(z.number().int()),
  // flags
  recebe_pdv: opcional(z.enum(['S', 'N'])),
  permite_sangria_pdv: opcional(z.enum(['S', 'N'])),
  lanc_movimento_individual: opcional(z.enum(['S', 'N'])),
  tipo: opcional(z.enum(['E', 'N'])),
  inativo: opcional(z.enum(['S', 'N'])),
});

/** DESTINO='QUE' não pode receber no PDV (uCadFormaPgto.pas:274 — "Quebra não recebe no PDV"). */
const refineQuePdv = (d: { destino?: string; recebe_pdv?: string }, ctx: z.RefinementCtx) => {
  if (d.destino === 'QUE' && d.recebe_pdv === 'S') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recebe_pdv'], message: "O destino 'Quebra de Caixa' não pode ser recebido no PDV." });
  }
};

export const formaPgtoSchema = z.preprocess(stripNulls, formaPgtoBase).superRefine(refineQuePdv as any);
export const atualizarFormaPgtoSchema = z.preprocess(stripNulls, formaPgtoBase.partial()).superRefine(refineQuePdv as any);

export type CriarFormaPgtoDto = z.infer<typeof formaPgtoBase>;

/** Registro devolvido pela API (view get_formas_pgto). */
export interface FormaPgto {
  idpgto: number;
  idempresa: number;
  modalidade: string;
  atalho: string;
  destino?: string;
  plccofre?: number;
  cofre?: string;
  codcontacorrente?: number;
  conta_corrente?: string;
  codplanocontas?: number;
  conta_contabil?: string;
  recebe_pdv?: string;
  permite_sangria_pdv?: string;
  lanc_movimento_individual?: string;
  tipo?: string;
  inativo?: string;
}
