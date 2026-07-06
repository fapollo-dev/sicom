import { z } from 'zod';

/**
 * CONTAS A RECEBER — corte-1 (cadastro/gestão do título). Espelha uCadAReceber (grava ARECEBER).
 * Multi-tenant por CODEMPRESA (carimbado do contexto pelo service, não vem do dto). A BAIXA é o
 * corte-2 (ARECEBER_BX). Mensagens em PT (ADR-015).
 *
 * Validações fiéis (uCadAReceber.pas): cliente obrigatório (:944), valor>0 (:937/:1009),
 * venc ≥ venda (:958), máx 200 parcelas (:930/:2894). Forma de pagamento obrigatória no legado
 * (:951) fica ADIADA no corte-1 (o cadastro de MODALIDADES ainda não foi migrado — sem lookup).
 */

/** '' / null → ausente antes do validador. */
const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

/** decimal tolerante: a API devolve numeric como STRING; aceita número OU string numérica. */
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

export const AR_TIPODOC_OPCOES = [
  { value: 'DUPLICATA', label: 'Duplicata' },
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'BANCARIA', label: 'Bancária' },
  { value: 'CARTEIRA', label: 'Carteira' },
  { value: 'A VISTA', label: 'À vista' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CARTAO', label: 'Cartão' },
  { value: 'OUTRA', label: 'Outra' },
] as const;

const areceberBase = z.object({
  // cliente do título (parceiros) — obrigatório
  codparceiro: z.number({ message: 'Informe o cliente do documento.' }).int('Cliente inválido.'),
  // datas (ISO 'YYYY-MM-DD')
  dtvenda: z.string().min(1, 'Informe a data de venda/emissão.'),
  dtvenc: z.string().min(1, 'Informe a data de vencimento.'),
  // valores
  valor: dec(z.number().positive('O valor da parcela deve ser maior que zero.')),
  txjuros: dec(z.number().min(0)),
  txmulta: dec(z.number().min(0)),
  desconto_boleto: dec(z.number().min(0)),
  nrodup: opcional(z.number().int().min(1, 'Mínimo 1 parcela.').max(200, 'Máximo de 200 parcelas.')),
  // documento / classificação
  duplicata: opcional(z.string().max(20)),
  tipodoc: opcional(z.string().max(25)),
  nroped: opcional(z.string().max(20)),
  nrocupom: opcional(z.string().max(20)),
  // lookups opcionais
  codvendedor: opcional(z.number().int()),
  codcobrador: opcional(z.number().int()),
  idpgto: opcional(z.number().int()),
  codbco: opcional(z.number().int()),
  codplc: opcional(z.number().int()),
  idsituacao_nf: opcional(z.number().int()),
  obs: opcional(z.string()),
});

/** venc ≥ venda (uCadAReceber.pas:958). */
const refineDatas = (d: { dtvenda?: string; dtvenc?: string }, ctx: z.RefinementCtx) => {
  if (d.dtvenda && d.dtvenc && d.dtvenc < d.dtvenda) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dtvenc'], message: 'O vencimento não pode ser anterior à data de venda.' });
  }
};

export const areceberSchema = z.preprocess(stripNulls, areceberBase).superRefine(refineDatas as any);
export const atualizarAreceberSchema = z
  .preprocess(stripNulls, areceberBase.partial())
  .superRefine(refineDatas as any);

export type CriarAreceberDto = z.infer<typeof areceberBase>;

/**
 * BAIXA (recebimento/pagamento) — corte-2 núcleo. Quita o título com juros/multa/desconto. Os campos
 * são opcionais: sem valorpg, o service calcula `valor + juros + acréscimo − desconto` (total) e usa a
 * data de hoje. **BAIXA PARCIAL (corte-3a):** se `valorpg` < total, o título original é quitado e um
 * NOVO título com o SALDO (total − pago) é gerado (ORIGEM='B', UBaixaAreceber.pas:1403); o estorno
 * remove esse saldo. `recurso` (corte-2 do CAIXA): **DINHEIRO** lança o valor no caixa ABERTO do
 * operador (recebimento=entrada / pagamento=saída), na mesma transação; ausente = baixa sem caixa
 * (dinheiro foi p/ banco/outro — comportamento do corte-1). Cheque/cartão/permuta/troco = corte-3.
 */
export const baixarTituloSchema = z.preprocess(
  stripNulls,
  z
    .object({
      dtpgto: opcional(z.string()), // ISO; default = hoje no service
      juros: dec(z.number().min(0)),
      multa: dec(z.number().min(0)),
      desconto: dec(z.number().min(0)),
      acrescimo: dec(z.number().min(0)),
      valorpg: dec(z.number().positive('O valor recebido deve ser maior que zero.')),
      dtvencSaldo: opcional(z.string()), // vencimento do título-saldo na baixa PARCIAL (default = dtpgto/hoje)
      // DINHEIRO → lança no caixa (contábil D/C 183); BANCO → depósito direto (contábil D/C = conta contábil do
      // banco, contas_bancarias.codlanccontabil; NÃO toca o caixa). Cheque/cartão = corte-3 (tabelas ausentes).
      recurso: opcional(z.enum(['DINHEIRO', 'BANCO'], { message: 'Recurso de baixa inválido (DINHEIRO ou BANCO).' })),
      codconta: dec(z.number().int().positive()), // conta bancária do depósito (obrigatória se recurso=BANCO)
      obs: opcional(z.string()),
    })
    .superRefine((v, ctx) => {
      if (v.recurso === 'BANCO' && v.codconta == null)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['codconta'], message: 'Informe a conta bancária do depósito (recurso BANCO).' });
    }),
);
export type BaixarTituloDto = z.infer<typeof baixarTituloSchema>;

/** registro devolvido pela API (view get_areceber) — colunas cruas + calculadas + display. */
export interface Areceber {
  codrcb: number;
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
  codvendedor?: number;
  codcobrador?: number;
  idpgto?: number;
  codbco?: number;
  codplc?: number;
  idsituacao_nf?: number;
}
