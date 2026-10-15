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
// o campo que se LIMPA: o vazio vira null e o null passa (o legado limpa o vínculo no exit vazio — edtCodContaExit, edtCodPLCExit)
const limpavel = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' ? null : v), s.nullable().optional());

// os campos limpáveis mantêm o null (é como se limpa); os demais perdem o null (o enum/obrigatório não o aceita)
const LIMPAVEIS = new Set(['plccofre', 'codcontacorrente', 'codplanocontas', 'comissao', 'acre_desc', 'troco_limite', 'codcontabil', 'codconpagto',
  'valor_minimo_fv', 'cfopdentrodoestado', 'cfopforadoestado', 'idpgto_pai']);
const stripNulls = (v: unknown): unknown => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === null && !LIMPAVEIS.has(k)) continue;
      if (val !== undefined) o[k] = val;
    }
    return o;
  }
  return v;
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
  // o combo A..Z do legado (cbbATALHO); a coluna tem 20
  atalho: z.string().trim().min(1, 'Informe o atalho (tecla).').max(20, 'Atalho muito longo (máx. 20).'),
  // DESTINO é OBRIGATÓRIO (ValidaObrigatorio(cbbDestino), uCadFormaPgto.pas:324) — é a chave de
  // roteamento do fechamento. No create exige; no update partial vira opcional (base.partial()).
  destino: z.enum(DESTINO_VALUES, { message: 'Informe o destino da forma de pagamento.' }),
  // vínculos de integração (soft-ref; destravam o Caixa corte-2d)
  plccofre: limpavel(z.number().int()),
  codcontacorrente: limpavel(z.number().int()),
  codplanocontas: limpavel(z.number().int()),
  // o resto da aba "Formas de Pagamento" do uCadFormaPgto.dfm: comissão, troco limite (só TEF/CRT), desc/acres. (+/-), código contábil,
  // condição de pagamento, valor mínimo para venda; a aba CFOP (dentro/fora do estado)
  comissao: limpavel(z.coerce.number()),
  troco_limite: limpavel(z.coerce.number().min(0)),
  acre_desc: limpavel(z.coerce.number()),
  codcontabil: limpavel(z.string().trim().max(30)),
  codconpagto: limpavel(z.coerce.number().int().positive()),
  valor_minimo_fv: limpavel(z.coerce.number().min(0)),
  cfopdentrodoestado: limpavel(z.coerce.number().int().positive()),
  cfopforadoestado: limpavel(z.coerce.number().int().positive()),
  // gravados pelo binário novo (fora do .dfm de 2020): a forma pai, exige permissão, baixa automática do documento
  idpgto_pai: limpavel(z.coerce.number().int().positive()),
  exige_permissao: opcional(z.enum(['S', 'N'])),
  baixa_documento_automatico: opcional(z.enum(['S', 'N'])),
  // a aba "Condições de pagamento" (REL_FORMA_PAGAMENTO_CONDICAO): os códigos; ausente = não mexe
  condicoes: z.preprocess(
    // a tela guarda as linhas da grade ({ codconpagto, condicao_pagamento }); vão só os códigos
    (v) => (Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? (x as { codconpagto?: unknown }).codconpagto : x)) : v),
    z.array(z.coerce.number().int().positive()).max(200).optional(),
  ),
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
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recebe_pdv'], message: 'O destino "Quebra de caixa" não pode ser recebido no PDV.' });
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
