import { z } from 'zod';

/**
 * CAIXA — corte-1 (sessão + movimento manual). Espelha UabertCaixa (abrir), uMovCaixa (movimento
 * manual) e o fechamento simples de uFechamentoCaixa. Multi-tenant por CODEMPRESA + operador
 * (carimbados do contexto pelo service, não vêm do dto). Estorno lógico e wire da baixa AR/AP são
 * o corte-2. Mensagens em PT (ADR-015).
 *
 * Validações fiéis: fundo de caixa ≥ 0 (UabertCaixa fundo de caixa); valor do movimento > 0
 * (uMovCaixa gravar). A ESPÉCIE define o sinal (SUPRIMENTO/ENTRADA entram; SANGRIA/SAIDA saem) —
 * o `tipo` E/S é derivado no service, não é enviado pelo cliente (evita inconsistência sinal×espécie).
 */

/** '' / null → ausente antes do validador. */
const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

/** decimal tolerante OPCIONAL: aceita número OU string numérica; '' / null → ausente. */
const dec = (inner: z.ZodNumber = z.number()) =>
  z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  }, inner.optional());

/** decimal tolerante OBRIGATÓRIO (coerção string→número, sem tornar opcional). */
const decReq = (inner: z.ZodNumber) =>
  z.preprocess((v) => {
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  }, inner);

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

/** Espécies do corte-1 (SUPRIMENTO/ENTRADA entram; SANGRIA/SAIDA saem). */
export const CAIXA_ESPECIE_OPCOES = [
  { value: 'SUPRIMENTO', label: 'Suprimento (entrada)', tipo: 'E' },
  { value: 'ENTRADA', label: 'Entrada avulsa', tipo: 'E' },
  { value: 'SANGRIA', label: 'Sangria (retirada)', tipo: 'S' },
  { value: 'SAIDA', label: 'Saída avulsa', tipo: 'S' },
] as const;

/** Abertura de caixa: fundo de caixa (opcional, ≥ 0) + observação. */
export const abrirCaixaSchema = z.preprocess(
  stripNulls,
  z.object({
    saldoInicial: dec(z.number().min(0, 'O fundo de caixa não pode ser negativo.')),
    obs: opcional(z.string()),
  }),
);
export type AbrirCaixaDto = z.infer<typeof abrirCaixaSchema>;

/** Movimento manual: espécie + valor (> 0). O `tipo` E/S é derivado da espécie no service. */
export const movimentoCaixaSchema = z.preprocess(
  stripNulls,
  z.object({
    especie: z.enum(['SUPRIMENTO', 'ENTRADA', 'SANGRIA', 'SAIDA'], {
      message: 'Espécie de movimento inválida.',
    }),
    valor: decReq(z.number({ message: 'Informe o valor do movimento.' }).positive('O valor do movimento deve ser maior que zero.')),
    recurso: opcional(z.string().max(20)),
    obs: opcional(z.string()),
  }),
);
export type MovimentoCaixaDto = z.infer<typeof movimentoCaixaSchema>;

/**
 * Fechamento de caixa (corte-2b — conferência). SEM `valorContado` = fecha simples (corte-1: saldo
 * final = saldo corrente). COM `valorContado` = conferência: diferença = contado − esperado; <0 quebra
 * (gera título A Receber contra o parceiro do operador, se `gerarTituloQuebra`), >0 sobra (só registra).
 */
export const fecharCaixaSchema = z.preprocess(
  stripNulls,
  z.object({
    valorContado: dec(z.number().min(0, 'O valor contado não pode ser negativo.')),
    gerarTituloQuebra: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.boolean().optional()),
    obs: opcional(z.string()),
  }),
);
export type FecharCaixaDto = z.infer<typeof fecharCaixaSchema>;

/** Sessão de caixa devolvida pela API (view get_caixa_sessao). */
export interface CaixaSessao {
  codcaixa: number;
  codempresa: number;
  codoperador?: number;
  dtabertura?: string;
  dtfechamento?: string;
  saldo_inicial?: number | string;
  saldo_final?: number | string;
  saldo_corrente?: number | string;
  status?: string; // 'A' | 'F'
  obs?: string;
  // 049 (conferência do fechamento)
  valor_contado?: number | string;
  diferenca?: number | string; // contado − esperado; <0 quebra, >0 sobra
  codrcb_quebra?: number; // título A Receber gerado na quebra
}

/** Movimento de caixa devolvido pela API (tabela caixa_mov). */
export interface CaixaMov {
  codmov: number;
  codcaixa: number;
  codempresa: number;
  tipo?: string; // 'E' | 'S'
  especie?: string;
  recurso?: string;
  valor?: number | string;
  data_operacao?: string;
  indr?: string; // 'I' | 'E'
  obs?: string;
}
